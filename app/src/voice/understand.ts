import type { Customer, EntryKind, ExpenseCategory, Item, PayMethod, VoiceAlias } from '../db'
import { round3 } from '../stock'
import { isNumberWord, readNumber } from './numbers'

// Works out what a spoken sentence means, on the phone, without any AI.
// It leans on what the shop already has: its own item names and customer names.
//
//   "sukari kilo mbili mia tatu cash"   -> sale, 2 kg Sugar, KSh 300, cash
//   "nimelipa stima mia tano mpesa"     -> expense, electricity, KSh 500, M-Pesa
//   "Mary amechukua mkate kwa deni soo" -> credit to Mary, Bread, KSh 100
//   "Mary amelipa deni mia mbili"       -> debt payment from Mary, KSh 200
//
// `sure` is false when something is missing or left unexplained. The caller then asks the
// person to check, instead of guessing.

export type VoiceLine = { item: Item; qty: number; totalCents: number }

export type VoiceDraft = {
  heard: string
  kind: EntryKind
  amountCents: number | null
  method: PayMethod
  category?: ExpenseCategory
  lines: VoiceLine[]
  customer?: Customer
  /** A name that was said but is not a customer yet. */
  newCustomerName?: string
  note?: string
  /** Words nothing could explain. If the person fixes the entry by hand, these are what get learned. */
  unknown: string[]
  sure: boolean
}

/** What the reader knows about the shop. */
export type ShopWords = { items: Item[]; customers: Customer[]; aliases?: VoiceAlias[] }

const words = (list: string) => new Set(list.split(' '))

export const MPESA = words('mpesa till paybill')
export const CASH = words('cash kash taslimu')
export const CREDIT = words('deni credit mkopo amekopa anadaiwa kopesha nimemkopesha madeni')
export const PAID_DEBT = words('amelipa alilipa amerudisha ameleta amemaliza paid payment malipo pays repaid')
export const EXPENSE = words('expense expenses matumizi nimelipa tumelipa nimetumia tumetumia spent')
export const SALE = words('sale sales sold nimeuza ameuza tumeuza mauzo uza')
const MONEY = words('shillings shilling shilingi bob ksh kes sh')
const FILLER = words(
  'na ya wa kwa za la ni the a an of for to and at on in is ile hii hiyo amechukua amenunua alichukua took bought buys from kutoka',
)

const CATEGORY: [ExpenseCategory, Set<string>][] = [
  ['rent', words('rent kodi')],
  ['transport', words('transport usafiri fare nauli boda bodaboda matatu fuel mafuta petrol')],
  ['electricity', words('electricity stima umeme tokens token kplc')],
  ['water', words('water maji')],
  ['wages', words('wages wage salary mshahara mishahara')],
  ['stock', words('stock stoki restock bidhaa supplier')],
]

/** Things sold whole. For these a spoken amount is a price, not a part of one. */
const COUNTED = words('pcs pkts crates bunches cups')

/** Spoken unit words, and which unit each one means. */
const UNIT_OF: Record<string, string> = {}
for (const [unit, list] of Object.entries({
  kg: 'kilo kilos kg kgs',
  g: 'gram grams gramu g',
  l: 'litre litres liter liters lita l',
  ml: 'ml',
  pcs: 'piece pieces pc pcs kipande vipande',
  pkts: 'packet packets pakiti pkt pkts',
  cups: 'cup cups kikombe vikombe',
  bunches: 'bunch bunches fungu mafungu',
  crates: 'crate crates kreti',
  m: 'metre metres meter meters mita',
})) {
  for (const word of list.split(' ')) UNIT_OF[word] = unit
}
const UNIT_WORDS = new Set(Object.keys(UNIT_OF))
const KNOWN_UNITS = Object.fromEntries(Object.values(UNIT_OF).map((unit) => [unit, true]))

/**
 * Everyday goods that people name in either language. If the shop lists "Sugar", saying
 * "sukari" still finds it. Add a line here to teach it another pair.
 */
const SAME_GOODS = [
  'sugar sukari', 'bread mkate boflo', 'milk maziwa', 'flour unga', 'rice mchele', 'salt chumvi',
  'egg eggs yai mayai', 'soap sabuni', 'oil mafuta', 'water maji', 'tea chai majani', 'beans maharagwe',
  'tomato tomatoes nyanya', 'onion onions kitunguu vitunguu', 'potato potatoes viazi waru',
  'cabbage kabichi', 'kale sukuma', 'maize mahindi', 'meat nyama', 'fish samaki', 'charcoal makaa',
  'paraffin kerosene mafuta-taa', 'matches kiberiti', 'airtime credo',
].map((group) => group.split(' '))
const sameGoods = (a: string, b: string) => SAME_GOODS.some((group) => group.includes(a) && group.includes(b))

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/m[\s-]*pesa/g, 'mpesa')
    .replace(/ksh\.?\s*(?=\d)/g, 'ksh ')
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** One letter wrong, missing or extra still counts for longer words: "sukali" matches "sukari". */
function close(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Plural "s" is ignored: "breads" matches "bread". */
const same = (said: string, name: string) =>
  close(said, name) || close(said.replace(/s$/, ''), name.replace(/s$/, '')) || sameGoods(said, name)

/** Finds where a name (one or more words) was said. Returns the span, or null. */
export function findName(said: string[], taken: boolean[], name: string): [number, number] | null {
  const parts = normalise(name)
  if (parts.length === 0) return null
  for (let start = 0; start + parts.length <= said.length; start++) {
    let ok = true
    for (let k = 0; k < parts.length; k++) {
      if (taken[start + k] || !same(said[start + k], parts[k])) {
        ok = false
        break
      }
    }
    if (ok) return [start, start + parts.length]
  }
  return null
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function understand(text: string, shop: ShopWords): VoiceDraft {
  const said = normalise(text)
  const taken = said.map(() => false)
  const take = (from: number, to: number) => {
    for (let i = from; i < to; i++) taken[i] = true
  }
  const has = (set: Set<string>) => said.some((w) => set.has(w))
  const takeAll = (set: Set<string>) => said.forEach((w, i) => set.has(w) && (taken[i] = true))

  // --- how it was paid
  const method: PayMethod = has(MPESA) ? 'mpesa' : 'cash'
  takeAll(MPESA)
  takeAll(CASH)

  // --- words this shop has taught it come first
  let customer: Customer | undefined
  let taughtCategory: ExpenseCategory | undefined
  const spans: { item: Item; start: number; end: number }[] = []
  for (const alias of [...(shop.aliases ?? [])].sort((a, b) => b.phrase.length - a.phrase.length)) {
    const span = findName(said, taken, alias.phrase)
    if (!span) continue
    if (alias.target === 'item') {
      const item = shop.items.find((i) => i.id === alias.targetId)
      if (!item) continue
      spans.push({ item, start: span[0], end: span[1] })
    } else if (alias.target === 'customer') {
      const known = shop.customers.find((c) => c.id === alias.targetId)
      if (!known || customer) continue
      customer = known
    } else {
      taughtCategory = alias.targetId as ExpenseCategory
    }
    take(...span)
  }

  // --- who (longest names first, so "Mary Wanjiku" wins over "Mary")
  for (const c of customer ? [] : [...shop.customers].sort((a, b) => b.name.length - a.name.length)) {
    const span = findName(said, taken, c.name)
    if (span) {
      customer = c
      take(...span)
      break
    }
  }

  // --- which of the shop's items were named
  for (const item of [...shop.items].sort((a, b) => b.name.length - a.name.length)) {
    const span = findName(said, taken, item.name)
    if (span) {
      spans.push({ item, start: span[0], end: span[1] })
      take(...span)
    }
  }
  spans.sort((a, b) => a.start - b.start)

  // --- what kind of entry
  // A word like "maji" means the water bill, unless this shop sells water and that is what was named.
  let category: ExpenseCategory | undefined = taughtCategory
  for (const [id, set] of category ? [] : CATEGORY) {
    if (said.some((w, i) => set.has(w) && !taken[i])) {
      category = id
      break
    }
  }
  const saysCredit = has(CREDIT)
  const saysPaid = has(PAID_DEBT)
  let kind: EntryKind
  if (saysPaid && (customer || saysCredit)) kind = 'payment'
  else if (saysCredit) kind = 'credit'
  else if (has(EXPENSE) || (category && !has(SALE))) kind = 'expense'
  else kind = 'sale'
  if (kind !== 'expense') category = undefined
  // For an expense the bill word counts even if the shop also sells that thing.
  else category = taughtCategory ?? CATEGORY.find(([, set]) => has(set))?.[0] ?? 'other'

  takeAll(CREDIT)
  takeAll(PAID_DEBT)
  takeAll(EXPENSE)
  takeAll(SALE)
  if (kind === 'expense') for (const [, set] of CATEGORY) takeAll(set)
  // Items only belong on sales and credit.
  if (kind !== 'sale' && kind !== 'credit') spans.length = 0

  // --- every number that was said, and what sits next to it
  type Num = { start: number; end: number; value: number; used: boolean; money: boolean; unit: string | undefined }
  const numbers: Num[] = []
  for (let i = 0; i < said.length; ) {
    const n = taken[i] ? null : readNumber(said, i)
    if (!n) {
      i++
      continue
    }
    numbers.push({
      start: i,
      end: n.end,
      value: n.value,
      used: false,
      money: MONEY.has(said[n.end] ?? '') || MONEY.has(said[i - 1] ?? ''),
      unit: UNIT_OF[said[n.end] ?? ''] ?? UNIT_OF[said[i - 1] ?? ''],
    })
    take(i, n.end)
    i = n.end
  }
  takeAll(MONEY)

  // --- which items (only sales and credit carry items)
  const lines: VoiceLine[] = []
  let quantitySaid = false
  takeAll(UNIT_WORDS)

  for (const { item, start, end } of spans) {
    // The quantity is a number right beside the item, with at most a unit word or "ya" between.
    const fits = (n: Num) => n.unit === undefined || n.unit === item.unit || !(item.unit in KNOWN_UNITS)
    const beside = numbers.filter(
      (n) => !n.used && !n.money && fits(n) && (start - n.end <= 1 && n.end <= start ? true : n.start - end <= 1 && n.start >= end),
    )
    const byAmount = beside.find((n) => n.start >= end && said[n.start - 1] === 'ya') // "sukari ya hamsini"
    const others = numbers.filter((n) => !n.used).length
    const qtyNumber =
      beside.find((n) => n.unit && n !== byAmount) ??
      // A small bare number is a count ("mkate mbili") if some other number can be the money.
      beside.find((n) => n !== byAmount && n.value < 20 && (others > 1 || item.priceCents !== undefined))

    let qty = 1
    let totalCents = 0
    if (qtyNumber) {
      qtyNumber.used = true
      qty = qtyNumber.value
      quantitySaid = true
    }
    if (byAmount && item.priceCents) {
      byAmount.used = true
      quantitySaid = true
      totalCents = Math.round(byAmount.value * 100)
      qty = round3(totalCents / item.priceCents)
    } else if (item.priceCents !== undefined) {
      totalCents = Math.round(item.priceCents * qty)
    }
    lines.push({ item, qty, totalCents })
  }

  // --- the amount: a number marked as money, else the biggest one left
  const free = numbers.filter((n) => !n.used)
  const linesTotal = lines.reduce((total, l) => total + l.totalCents, 0)
  let amountNumber: Num | undefined = free.find((n) => n.money) ?? [...free].sort((a, b) => b.value - a.value)[0]
  // "… tatu" left over beside priced items is far more likely a missed quantity than KSh 3.
  if (amountNumber && !amountNumber.money && linesTotal > 0 && amountNumber.value * 100 < linesTotal / 2) amountNumber = undefined
  // Nothing costs two shillings: a bare "mbili" beside an unknown word is a quantity of something
  // it did not recognise, so it is left unexplained rather than saved as money.
  if (amountNumber && !amountNumber.money && amountNumber.value < 5) amountNumber = undefined
  let amountCents: number | null = null
  if (!amountNumber && linesTotal > 0) amountCents = linesTotal
  if (amountNumber) {
    amountNumber.used = true
    amountCents = Math.round(amountNumber.value * 100)
    // "sukari hamsini": one item, no quantity said, and the money is not its price -> sold by amount.
    const only = lines.length === 1 ? lines[0] : null
    if (only && !quantitySaid && only.item.priceCents && only.totalCents !== amountCents) {
      only.totalCents = amountCents
      // Loose goods: work out how much that money buys. Whole goods: one of them, at that price.
      if (!COUNTED.has(only.item.unit)) only.qty = round3(amountCents / only.item.priceCents)
    }
  }

  // --- words nobody claimed
  const leftover = said.filter((w, i) => !taken[i] && !FILLER.has(w) && !isNumberWord(w))
  const unknown = [...leftover]

  // A name after credit or payment words that is not a known customer becomes a new one.
  let newCustomerName: string | undefined
  if ((kind === 'credit' || kind === 'payment') && !customer && leftover.length > 0) {
    newCustomerName = leftover.splice(0, Math.min(2, leftover.length)).map(capitalise).join(' ')
  }

  const note = leftover.length > 0 && leftover.length <= 6 ? capitalise(leftover.join(' ')) : undefined
  const unexplainedNumbers = numbers.some((n) => !n.used)
  const needsCustomer = kind === 'credit' || kind === 'payment'
  const sure =
    amountCents !== null &&
    amountCents > 0 &&
    !unexplainedNumbers &&
    (lines.length > 0 ? leftover.length === 0 : leftover.length <= 6) &&
    (!needsCustomer || customer !== undefined || newCustomerName !== undefined)

  return {
    heard: text.trim(),
    kind,
    amountCents,
    method: kind === 'credit' ? 'credit' : method,
    category,
    lines,
    customer,
    newCustomerName,
    note: lines.length > 0 && kind !== 'expense' ? undefined : note,
    unknown,
    sure,
  }
}

