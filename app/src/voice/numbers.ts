// Turns spoken numbers into values, in English, Swahili and Sheng, without any AI.
//
//   "three hundred"            -> 300      "mia tatu"            -> 300
//   "two thousand five hundred"-> 2500     "elfu mbili mia tano" -> 2500
//   "soo mbili finje"          -> 250      "thao moja"           -> 1000
//   "ishirini na tano"         -> 25       "moja na nusu"        -> 1.5
//
// To teach it a new word, add it to one of the lists below.

/** Numbers under 100 that add together: "twenty" + "five", "ishirini" + "tano". */
const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
  sifuri: 0, moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70, themanini: 80, tisini: 90,
}

/**
 * Words that are multiplied by the number said AFTER them: "mia tatu" = 100 x 3, "soo mbili" = 200.
 * Said alone they mean one of them: "soo" = 100. The Sheng money words live here.
 */
const BASE: Record<string, number> = {
  mia: 100, elfu: 1000,
  soo: 100, thao: 1000, ngiri: 1000, tenga: 1000, punch: 500,
  finje: 50, chwani: 50, hamsa: 50, mbao: 20, ashu: 10, kobole: 5,
}

const FRACTION: Record<string, number> = { nusu: 0.5, half: 0.5, robo: 0.25, quarter: 0.25 }

type Token = { kind: 'digits' | 'small' | 'base' | 'fraction' | 'hundred' | 'thousand'; value: number }

function classify(word: string | undefined): Token | null {
  if (!word) return null
  if (word in SMALL) return { kind: 'small', value: SMALL[word] }
  if (word in BASE) return { kind: 'base', value: BASE[word] }
  if (word in FRACTION) return { kind: 'fraction', value: FRACTION[word] }
  if (word === 'hundred') return { kind: 'hundred', value: 100 }
  if (word === 'thousand') return { kind: 'thousand', value: 1000 }
  // 300   1,500   2.5   2k   1.5k
  const digits = /^(\d[\d,]*(?:\.\d+)?)(k?)$/.exec(word)
  if (digits) return { kind: 'digits', value: Number(digits[1].replace(/,/g, '')) * (digits[2] ? 1000 : 1) }
  return null
}

export const isNumberWord = (word: string | undefined) => classify(word) !== null

const JOINERS = new Set(['na', 'and'])

/**
 * Reads one number starting at `start`. Returns its value and the position just after it,
 * or null if no number starts there. It stops where a second number would begin, so
 * "kilo mbili mia tatu" is read as 2 and then 300, not 302.
 */
export function readNumber(words: string[], start: number): { value: number; end: number } | null {
  let thousands = 0 // finished "x thousand" part
  let hundreds = 0 // hundreds and Sheng money words
  let small = 0 // the part under 100
  let i = start
  let any = false
  let joined = false // the previous word was "na" / "and"

  const result = () => (any ? { value: thousands + hundreds + small, end: i } : null)

  while (i < words.length) {
    const token = classify(words[i])

    if (!token) {
      // "na" / "and" only continues a number: "ishirini na tano", "one and a half".
      const next = classify(words[i + 1])
      if (any && JOINERS.has(words[i]) && next && (next.kind === 'small' || next.kind === 'fraction')) {
        joined = true
        i++
        continue
      }
      break
    }

    if (token.kind === 'digits') {
      if (any) break
      i++
      // "2 thousand", "5 hundred"
      const after = classify(words[i])
      if (after?.kind === 'thousand' || after?.kind === 'hundred') {
        i++
        return { value: token.value * (after.kind === 'thousand' ? 1000 : 100), end: i }
      }
      return { value: token.value, end: i }
    }

    if (token.kind === 'fraction') {
      // "nusu" alone is a half; "moja na nusu" is one and a half. A fraction always ends the number.
      small += token.value
      any = true
      i++
      break
    }

    if (token.kind === 'small') {
      const v = token.value
      if (small === 0 || (small >= 20 && small % 10 === 0 && v < 10) || (small === 10 && v < 10 && joined)) {
        small += v
      } else if (small >= 1 && small <= 9 && v >= 20 && v % 10 === 0 && hundreds === 0 && !joined) {
        // The everyday short form: "one fifty" = 150, "two twenty" = 220.
        hundreds = small * 100
        small = v
      } else {
        break // "two five" is two numbers
      }
    } else if (token.kind === 'hundred') {
      if (hundreds > 0) break
      hundreds = (small || 1) * 100
      small = 0
    } else if (token.kind === 'thousand') {
      if (thousands > 0) break
      thousands = (hundreds + small || 1) * 1000
      hundreds = 0
      small = 0
    } else {
      // A base word: "mia", "elfu", "soo", "thao", "mbao"…
      // A plain number just before it belongs to something else: "mbili | mia tatu".
      if (small > 0) break
      const base = token.value
      let times = 1
      const next = classify(words[i + 1])
      if (base >= 1000) {
        // "elfu mbili", "thao kumi na mbili": the multiplier is a number under 1000.
        const multiplier = readNumber(words, i + 1)
        if (next?.kind === 'small' && multiplier && multiplier.value >= 1 && multiplier.value < 1000) {
          times = multiplier.value
          i = multiplier.end - 1
        }
        if (thousands > 0) break
        thousands = base * times
      } else {
        if (next?.kind === 'small' && next.value >= 1 && next.value <= 9) {
          times = next.value
          i++
        }
        hundreds += base * times
      }
    }

    any = true
    joined = false
    i++
  }

  return result()
}
