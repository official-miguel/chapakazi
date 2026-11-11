import { useLiveQuery } from 'dexie-react-hooks'
import { Mic, Pencil, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addCustomer } from '../customers'
import { db, newId } from '../db'
import type { Entry, EntryLine } from '../db'
import { kindLabel, methodLabel } from '../entryKinds'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { addDays, cancelEntry, editEntry, entriesBetween, recordEntry, startOfDay } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useToast } from '../toast'
import { formatQty, unitName } from '../units'
import { useTimeFormat } from '../useTimeFormat'
import { understandEdit } from '../voice/command'
import type { EditDraft } from '../voice/command'
import { remember, whatWasLearned } from '../voice/learn'
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

/** How far back "the last sale" may reach. */
const EDIT_DAYS = 3

/** Of the browser's guesses at what was said, prefer the one that makes the most sense for this shop. */
const score = (d: VoiceDraft) => (d.sure ? 10 : 0) + d.lines.length * 2 + (d.customer ? 2 : 0) + (d.amountCents ? 1 : 0)

/** What is waiting for a yes or no: a new entry, or a change to an existing one. */
type Pending = { type: 'new'; draft: VoiceDraft } | { type: 'edit'; edit: EditDraft }

/** Speak an entry or a correction, hear it read back, and confirm with yes or no. */
export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { dir, person, shops, ownsShop } = useSession()
  const { time } = useTimeFormat()
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const [phase, setPhase] = useState<'idle' | 'listening' | 'confirm' | 'fix'>('idle')
  const [live, setLive] = useState('')
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [problem, setProblem] = useState<WordKey | null>(null)
  const [saving, setSaving] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const speechLang = lang === 'sw' ? 'sw-KE' : 'en-KE'

  const shop = useLiveQuery(async () => {
    const today = startOfDay(Date.now())
    return {
      items: (await db.items.where('businessId').equals(shopId).toArray()).filter((i) => !i.archived),
      customers: await db.customers.where('businessId').equals(shopId).toArray(),
      aliases: await db.voiceAliases.where('businessId').equals(shopId).toArray(),
      recent: (await entriesBetween([shopId], addDays(today, 1 - EDIT_DAYS), addDays(today, 1))).filter((e) => !e.cancelled),
    }
  }, [shopId])

  const stopAudio = useCallback(() => {
    recognition.current?.abort()
    recognition.current = null
    window.speechSynthesis?.cancel()
  }, [])
  useEffect(() => stopAudio, [stopAudio])

  // ---- putting things into words (shown on screen and read aloud)

  const describeDraft = (d: VoiceDraft): string[] =>
    [
      t(kindLabel[d.kind]),
      d.customer?.name ?? (d.newCustomerName ? `${d.newCustomerName} (${t('voice.newCustomer')})` : null),
      ...d.lines.map((l) => `${formatQty(l.qty)} ${unitName(t, l.item.unit)} ${l.item.name}`),
      d.kind === 'expense' ? t(categoryLabel(d.category)) : null,
      d.note ?? null,
      d.amountCents ? formatKsh(d.amountCents) : null,
      d.kind === 'credit' ? null : t(methodLabel[d.method]),
    ].filter((part): part is string => !!part)

  const describeEntry = (e: Entry): string =>
    [
      t(kindLabel[e.kind]),
      e.customerId ? shop?.customers.find((c) => c.id === e.customerId)?.name : null,
      e.note || e.lines?.map((l) => l.name).join(', ') || (e.kind === 'expense' ? t(categoryLabel(e.category)) : null),
      formatKsh(e.amountCents),
      t(methodLabel[e.method]),
      `${time(e.occurredAt)} · ${dir.people.find((p) => p.id === e.createdBy)?.name ?? ''}`,
    ]
      .filter(Boolean)
      .join(' · ')

  const describeEdit = (edit: EditDraft): string[] => {
    if (!edit.entry) return [t(edit.action === 'delete' ? 'voice.delete' : 'voice.change'), t('voice.noEntry')]
    const changes = [
      edit.amountCents !== undefined && edit.amountCents !== edit.entry.amountCents ? formatKsh(edit.amountCents) : null,
      edit.method !== undefined && edit.method !== edit.entry.method ? t(methodLabel[edit.method]) : null,
    ].filter(Boolean)
    return [
      t(edit.action === 'delete' ? 'voice.delete' : 'voice.change'),
      describeEntry(edit.entry),
      edit.action === 'change' && changes.length > 0 ? t('voice.to', { value: changes.join(', ') }) : null,
    ].filter((part): part is string => !!part)
  }

  const heard = pending ? (pending.type === 'new' ? pending.draft.heard : pending.edit.heard) : ''
  const sure = pending ? (pending.type === 'new' ? pending.draft.sure : pending.edit.sure) : false
  const parts = pending ? (pending.type === 'new' ? describeDraft(pending.draft) : describeEdit(pending.edit)) : []

  // ---- doing it

  const toLines = (d: VoiceDraft): EntryLine[] =>
    d.lines.map((l) => ({
      id: newId(),
      itemId: l.item.id,
      name: l.item.name,
      unit: l.item.unit,
      qty: l.qty,
      unitPriceCents: l.item.priceCents,
      totalCents: l.totalCents,
    }))

  const confirm = async (what: Pending) => {
    if (!person || saving) return
    const actor = { personId: person.id, isOwner: ownsShop(shopId) }
    setSaving(true)
    stopAudio()
    try {
      if (what.type === 'new') {
        const d = what.draft
        if (!d.amountCents) return
        const customerId = d.customer?.id ?? (d.newCustomerName ? await addCustomer(shopId, { name: d.newCustomerName }) : undefined)
        await recordEntry(
          shopId,
          { kind: d.kind, amountCents: d.amountCents, method: d.method, category: d.category, note: d.note, lines: toLines(d) },
          actor,
          customerId,
          'voice',
        )
      } else {
        const { entry, action, amountCents, method } = what.edit
        if (!entry) return
        if (action === 'delete') await cancelEntry(entry.id, actor)
        else {
          await editEntry(
            entry.id,
            {
              kind: entry.kind,
              amountCents: amountCents ?? entry.amountCents,
              method: method ?? entry.method,
              category: entry.category,
              note: entry.note,
              lines: entry.lines,
            },
            actor,
          )
        }
      }
      toast(t('entry.saved'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  /** Starts the microphone. With `answering`, it listens only for a yes or no about that thing. */
  const listen = (answering?: Pending) => {
    if (!RecognitionClass || !shop) return
    stopAudio()
    setProblem(null)
    setLive('')
    const r = new RecognitionClass()
    r.lang = speechLang
    r.interimResults = !answering
    r.maxAlternatives = 4
    r.continuous = false
    r.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      if (!answering) setLive(result[0].transcript)
      if (!result.isFinal) return
      const guesses = Array.from({ length: result.length }, (_, i) => result[i].transcript)
      if (answering) {
        const said = guesses.join(' ').toLowerCase().split(/\s+/)
        if (said.some((w) => YES.has(w))) void confirm(answering)
        else if (said.some((w) => NO.has(w))) listen()
        return
      }
      decide(guesses)
    }
    r.onerror = (event) => {
      if (answering) return // not hearing a yes or no is fine: the buttons are still there
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
    if (!answering) setPhase('listening')
    r.start()
  }

  const decide = (guesses: string[]) => {
    if (!shop) return
    // A request to change or delete is tried first; otherwise it is a new entry.
    const edits = guesses.map((g) => understandEdit(g, shop, shop.recent)).filter((e) => e !== null)
    const next: Pending | undefined =
      edits.length > 0
        ? { type: 'edit', edit: edits.find((e) => e.sure) ?? edits[0] }
        : (() => {
            const best = guesses.map((g) => understand(g, shop)).sort((a, b) => score(b) - score(a))[0]
            return best ? { type: 'new' as const, draft: best } : undefined
          })()
    if (!next) return
    setPending(next)
    setPhase('confirm')

    // Read it back. Only a confident reading is offered for a spoken yes or no.
    const isSure = next.type === 'new' ? next.draft.sure : next.edit.sure
    const words = next.type === 'new' ? describeDraft(next.draft) : describeEdit(next.edit)
    if (window.speechSynthesis) {
      const speech = new SpeechSynthesisUtterance(`${words.join(', ')}. ${isSure ? t('voice.correct') : t('voice.unsure')}`)
      speech.lang = speechLang
      if (isSure) speech.onend = () => listen(next)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(speech)
    }
  }

  const submitTyped = (e: FormEvent) => {
    e.preventDefault()
    if (typed.trim()) decide([typed])
  }

  if (phase === 'fix' && pending?.type === 'new') {
    const draft = pending.draft
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
          lines: toLines(draft),
        }}
        onSaved={(saved) => {
          // The correction shows what the unexplained word meant. Remember it for next time.
          const learned = whatWasLearned(draft, saved)
          if (!learned) return
          void remember(shopId, learned)
          const name =
            learned.target === 'item'
              ? shop?.items.find((i) => i.id === learned.targetId)?.name
              : learned.target === 'customer'
                ? (shop?.customers.find((c) => c.id === learned.targetId)?.name ?? draft.newCustomerName)
                : t(categoryLabel(saved.category))
          if (name) toast(t('voice.learned', { phrase: learned.phrase, name }))
        }}
        onClose={onClose}
      />
    )
  }

  const again = () => {
    stopAudio()
    setPending(null)
    setPhase('idle')
    if (RecognitionClass) listen()
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

      {phase === 'confirm' && pending ? (
        <>
          <p className="voice-heard">
            {t('voice.heard')}: “{heard}”
          </p>
          <ul className="voice-card">
            {parts.map((part, i) => (
              <li key={i}>{part}</li>
            ))}
          </ul>
          {sure ? (
            <>
              <p className="voice-ask">{t('voice.correct')}</p>
              <button
                type="button"
                className={pending.type === 'edit' && pending.edit.action === 'delete' ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={saving}
                onClick={() => void confirm(pending)}
              >
                {t('voice.yes')}
              </button>
            </>
          ) : (
            <p className="warn-note">{t('voice.unsure')}</p>
          )}
          <div className={pending.type === 'new' ? 'btn-pair' : undefined}>
            <button type="button" className="btn btn-quiet" onClick={again}>
              <Mic size={20} aria-hidden /> {t('voice.no')}
            </button>
            {pending.type === 'new' && (
              <button
                type="button"
                className={sure ? 'btn btn-quiet' : 'btn btn-primary'}
                onClick={() => {
                  stopAudio()
                  setPhase('fix')
                }}
              >
                <Pencil size={20} aria-hidden /> {t('voice.fix')}
              </button>
            )}
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
              {phase !== 'listening' && (
                <p className="hint-note">
                  {t('voice.example')}
                  <br />
                  {t('voice.editExample')}
                </p>
              )}
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
