import { useLiveQuery } from 'dexie-react-hooks'
import { Mic, Pencil, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addCustomer } from '../customers'
import { db, newId } from '../db'
import type { EntryLine } from '../db'
import { kindLabel, methodLabel } from '../entryKinds'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { recordEntry } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useToast } from '../toast'
import { formatQty, unitName } from '../units'
import { understand } from '../voice/understand'
import type { VoiceDraft } from '../voice/understand'
import { categoryLabel, EntryForm } from './EntryForm'
import { Sheet } from './Sheet'

// The browser's own speech recognition: free, no AI service of ours involved.
// (Not every browser has it, so there is always a box to type into instead.)
type Recognition = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  abort: () => void
}
type RecognitionWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }

const RecognitionClass =
  typeof window === 'undefined'
    ? undefined
    : ((window as RecognitionWindow).SpeechRecognition ?? (window as RecognitionWindow).webkitSpeechRecognition)

const YES = new Set('yes yeah yep correct sawa ndio ndiyo eeh ee poa fiti okay ok save hifadhi'.split(' '))
const NO = new Set('no nope hapana apana la zi wrong cancel tena again'.split(' '))

/** Of the browser's guesses at what was said, prefer the one that makes the most sense for this shop. */
const score = (d: VoiceDraft) => (d.sure ? 10 : 0) + d.lines.length * 2 + (d.customer ? 2 : 0) + (d.amountCents ? 1 : 0)

/** Speak an entry, hear it read back, and confirm with yes or no. */
export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { person, shops, ownsShop } = useSession()
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const [phase, setPhase] = useState<'idle' | 'listening' | 'confirm' | 'fix'>('idle')
  const [live, setLive] = useState('')
  const [typed, setTyped] = useState('')
  const [draft, setDraft] = useState<VoiceDraft | null>(null)
  const [problem, setProblem] = useState<WordKey | null>(null)
  const [saving, setSaving] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const speechLang = lang === 'sw' ? 'sw-KE' : 'en-KE'

  const shop = useLiveQuery(
    async () => ({
      items: (await db.items.where('businessId').equals(shopId).toArray()).filter((i) => !i.archived),
      customers: await db.customers.where('businessId').equals(shopId).toArray(),
    }),
    [shopId],
  )

  const stopAudio = useCallback(() => {
    recognition.current?.abort()
    recognition.current = null
    window.speechSynthesis?.cancel()
  }, [])
  useEffect(() => stopAudio, [stopAudio])

  /** The entry in words, as shown on screen and read aloud. */
  const describe = (d: VoiceDraft): string[] =>
    [
      t(kindLabel[d.kind]),
      d.customer?.name ?? (d.newCustomerName ? `${d.newCustomerName} (${t('voice.newCustomer')})` : null),
      ...d.lines.map((l) => `${formatQty(l.qty)} ${unitName(t, l.item.unit)} ${l.item.name}`),
      d.kind === 'expense' ? t(categoryLabel(d.category)) : null,
      d.note ?? null,
      d.amountCents ? formatKsh(d.amountCents) : null,
      d.kind === 'credit' ? null : t(methodLabel[d.method]),
    ].filter((part): part is string => !!part)

  const save = async (d: VoiceDraft) => {
    if (!person || !d.amountCents || saving) return
    setSaving(true)
    stopAudio()
    try {
      const customerId = d.customer?.id ?? (d.newCustomerName ? await addCustomer(shopId, { name: d.newCustomerName }) : undefined)
      const lines: EntryLine[] = d.lines.map((l) => ({
        id: newId(),
        itemId: l.item.id,
        name: l.item.name,
        unit: l.item.unit,
        qty: l.qty,
        unitPriceCents: l.item.priceCents,
        totalCents: l.totalCents,
      }))
      await recordEntry(
        shopId,
        { kind: d.kind, amountCents: d.amountCents, method: d.method, category: d.category, note: d.note, lines },
        { personId: person.id, isOwner: ownsShop(shopId) },
        customerId,
        'voice',
      )
      toast(t('entry.saved'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  /** Starts the microphone. `forAnswer` listens for yes or no about the given draft instead of a new entry. */
  const listen = (forAnswer?: VoiceDraft) => {
    if (!RecognitionClass || !shop) return
    stopAudio()
    setProblem(null)
    setLive('')
    const r = new RecognitionClass()
    r.lang = speechLang
    r.interimResults = !forAnswer
    r.maxAlternatives = 4
    r.continuous = false
    r.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      if (!forAnswer) setLive(result[0].transcript)
      if (!result.isFinal) return
      const guesses = Array.from({ length: result.length }, (_, i) => result[i].transcript)
      if (forAnswer) {
        const said = guesses.join(' ').toLowerCase().split(/\s+/)
        if (said.some((w) => YES.has(w))) void save(forAnswer)
        else if (said.some((w) => NO.has(w))) listen()
        return
      }
      decide(guesses)
    }
    r.onerror = (event) => {
      if (forAnswer) return // not hearing a yes or no is fine: the buttons are still there
      setPhase('idle')
      setProblem(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'voice.micBlocked'
          : event.error === 'no-speech'
            ? 'voice.nothing'
            : 'voice.failed',
      )
    }
    r.onend = () => setPhase((p) => (p === 'listening' ? 'idle' : p))
    recognition.current = r
    if (!forAnswer) setPhase('listening')
    r.start()
  }

  const decide = (guesses: string[]) => {
    if (!shop) return
    const best = guesses.map((g) => understand(g, shop)).sort((a, b) => score(b) - score(a))[0]
    if (!best) return
    setDraft(best)
    setPhase('confirm')
    // Read it back. Only a confident reading is offered for a spoken yes or no.
    if (window.speechSynthesis) {
      const speech = new SpeechSynthesisUtterance(`${describe(best).join(', ')}. ${best.sure ? t('voice.correct') : t('voice.unsure')}`)
      speech.lang = speechLang
      if (best.sure) speech.onend = () => listen(best)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(speech)
    }
  }

  const submitTyped = (e: FormEvent) => {
    e.preventDefault()
    if (typed.trim()) decide([typed])
  }

  if (phase === 'fix' && draft) {
    return (
      <EntryForm
        kind={draft.kind}
        draft={{
          shopId,
          amountCents: draft.amountCents,
          method: draft.method,
          category: draft.category,
          note: draft.note,
          customer: draft.customer,
          lines: draft.lines.map((l) => ({
            id: newId(),
            itemId: l.item.id,
            name: l.item.name,
            unit: l.item.unit,
            qty: l.qty,
            unitPriceCents: l.item.priceCents,
            totalCents: l.totalCents,
          })),
        }}
        onClose={onClose}
      />
    )
  }

  return (
    <Sheet title={t('voice.title')} onClose={onClose}>
      {shops.length > 1 && phase !== 'confirm' && (
        <div className="field">
          <span>{t('entry.shop')}</span>
          <div className="chips">
            {shops.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === shopId ? 'chip chip-on' : 'chip'}
                aria-pressed={s.id === shopId}
                onClick={() => setShopId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'confirm' && draft ? (
        <>
          <p className="voice-heard">
            {t('voice.heard')}: “{draft.heard}”
          </p>
          <ul className="voice-card">
            {describe(draft).map((part, i) => (
              <li key={i}>{part}</li>
            ))}
          </ul>
          {draft.sure ? (
            <>
              <p className="voice-ask">{t('voice.correct')}</p>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save(draft)}>
                {t('voice.yes')}
              </button>
            </>
          ) : (
            <p className="warn-note">{t('voice.unsure')}</p>
          )}
          <div className="btn-pair">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                stopAudio()
                setDraft(null)
                setPhase('idle')
                if (RecognitionClass) listen()
              }}
            >
              <Mic size={20} aria-hidden /> {t('voice.no')}
            </button>
            <button
              type="button"
              className={draft.sure ? 'btn btn-quiet' : 'btn btn-primary'}
              onClick={() => {
                stopAudio()
                setPhase('fix')
              }}
            >
              <Pencil size={20} aria-hidden /> {t('voice.fix')}
            </button>
          </div>
        </>
      ) : (
        <>
          {RecognitionClass ? (
            <div className="voice-stage">
              <button
                type="button"
                className={phase === 'listening' ? 'voice-mic voice-mic-on' : 'voice-mic'}
                aria-label={phase === 'listening' ? t('voice.stop') : t('mic.label')}
                disabled={!shop}
                onClick={() => {
                  if (phase === 'listening') {
                    stopAudio()
                    setPhase('idle')
                  } else listen()
                }}
              >
                {phase === 'listening' ? <Square size={34} aria-hidden /> : <Mic size={40} aria-hidden />}
              </button>
              <p className="voice-status" role="status">
                {phase === 'listening' ? live || t('voice.listening') : t('voice.tap')}
              </p>
              {phase !== 'listening' && <p className="hint-note">{t('voice.example')}</p>}
            </div>
          ) : (
            <p className="warn-note">{t('voice.unsupported')}</p>
          )}
          {problem && (
            <p className="field-error voice-problem" role="alert">
              {t(problem)}
            </p>
          )}
          <form className="voice-type" onSubmit={submitTyped}>
            <label className="field">
              <span>{t('voice.type')}</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={160} autoComplete="off" />
            </label>
            <button type="submit" className="btn btn-quiet" disabled={!typed.trim() || !shop}>
              {t('voice.go')}
            </button>
          </form>
        </>
      )}
    </Sheet>
  )
}
