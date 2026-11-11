import { useLiveQuery } from 'dexie-react-hooks'
import { Inbox } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { EntryForm } from '../components/EntryForm'
import { db } from '../db'
import type { EntryKind, MpesaPayment } from '../db'
import { useI18n } from '../i18n'
import { assignPayment, ignorePayment, reopenPayment, suggestFor } from '../inbox'
import type { InboxSuggestion } from '../inbox'
import { recordEntry } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useToast } from '../toast'
import { formatQty, unitName } from '../units'
import { useTimeFormat } from '../useTimeFormat'

const RECENT_SORTED = 10

/** M-Pesa payments that arrived by themselves. Each one is cleared by saying what it was for. */
export function InboxScreen() {
  const { t } = useI18n()
  const toast = useToast()
  const { dir, person, shops, ownsShop } = useSession()
  const { dateTime } = useTimeFormat()
  const [sorting, setSorting] = useState<{ payment: MpesaPayment; kind: EntryKind } | null>(null)
  const [busy, setBusy] = useState(false)

  const shopIds = shops.map((s) => s.id)
  const data = useLiveQuery(async () => {
    const all = (await db.mpesaPayments.where('businessId').anyOf(shopIds).toArray()).sort((a, b) => b.paidAt - a.paidAt)
    const waiting = all.filter((p) => p.status === 'unassigned')
    const suggestions = new Map<string, InboxSuggestion>()
    for (const p of waiting) {
      const s = await suggestFor(p)
      if (s) suggestions.set(p.id, s)
    }
    return { waiting, suggestions, sorted: all.filter((p) => p.status !== 'unassigned').slice(0, RECENT_SORTED) }
  }, [shopIds.join()])

  if (!person || !data) return null
  const { waiting, suggestions, sorted } = data
  const total = waiting.reduce((sum, p) => sum + p.amountCents, 0)
  const shopName = (p: MpesaPayment) => (shops.length > 1 ? dir.businesses.find((b) => b.id === p.businessId)?.name : undefined)
  const meta = (p: MpesaPayment) => [p.payerName, dateTime(p.paidAt), p.transId, shopName(p)].filter(Boolean).join(' · ')

  /** One tap on a suggestion records the entry and clears the payment. */
  const accept = async (p: MpesaPayment, s: InboxSuggestion) => {
    if (busy) return
    setBusy(true)
    try {
      const actor = { personId: person.id, isOwner: ownsShop(p.businessId) }
      const entryId =
        s.kind === 'sale'
          ? await recordEntry(p.businessId, { kind: 'sale', amountCents: p.amountCents, method: 'mpesa', lines: s.lines }, actor, undefined, 'mpesa')
          : await recordEntry(p.businessId, { kind: 'payment', amountCents: p.amountCents, method: 'mpesa' }, actor, s.customer.id, 'mpesa')
      await assignPayment(p.id, entryId, person.id)
      toast(t('entry.saved'))
    } finally {
      setBusy(false)
    }
  }

  const describe = (s: InboxSuggestion) =>
    s.kind === 'sale'
      ? s.lines.map((l) => `${formatQty(l.qty)} ${unitName(t, l.unit)} ${l.name}`).join(', ')
      : t('inbox.debtFrom', { name: s.customer.name })

  return (
    <>
      <h1 className="screen-title">{t('inbox.title')}</h1>

      {waiting.length === 0 ? (
        <EmptyState icon={<Inbox size={40} />} title={t('inbox.empty')} hint={t('inbox.emptyHint')} />
      ) : (
        <>
          <div className="total-card owed-card">
            <span className="total-label">{t('inbox.waiting', { n: waiting.length })}</span>
            <span className="total-value ink-amber">{formatKsh(total)}</span>
          </div>
          <div className="list list-gap">
            {waiting.map((p) => {
              const s = suggestions.get(p.id)
              return (
                <div key={p.id} className="worker-card">
                  <div className="worker-head">
                    <span className="list-main">
                      <span className="detail-amount money-in inbox-amount">{formatKsh(p.amountCents)}</span>
                      <span className="list-sub">{meta(p)}</span>
                    </span>
                    {p.test && <span className="tag tag-amber">{t('inbox.test')}</span>}
                  </div>
                  {s && (
                    <div className="inbox-suggest">
                      <span>
                        {t('inbox.usually')} <b>{describe(s)}</b>
                      </span>
                      <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void accept(p, s)}>
                        {t('inbox.yes')}
                      </button>
                    </div>
                  )}
                  <div className="btn-pair">
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setSorting({ payment: p, kind: 'sale' })}>
                      {t('entry.sale')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setSorting({ payment: p, kind: 'payment' })}>
                      {t('entry.payment')}
                    </button>
                  </div>
                  <button type="button" className="link-btn inbox-ignore" onClick={() => void ignorePayment(p.id, person.id)}>
                    {t('inbox.notOurs')}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {sorted.length > 0 && (
        <section className="history">
          <h3>{t('inbox.sorted')}</h3>
          <div className="list">
            {sorted.map((p) => (
              <div key={p.id} className="list-row">
                <span className="list-main">
                  <span className="list-title">{formatKsh(p.amountCents)}</span>
                  <span className="list-sub">{meta(p)}</span>
                </span>
                <span className="row-end">
                  <span className={p.status === 'ignored' ? 'tag' : 'tag tag-green'}>{t(p.status === 'ignored' ? 'inbox.notOurs' : 'inbox.done')}</span>
                  {p.status === 'ignored' && (
                    <button type="button" className="link-btn" onClick={() => void reopenPayment(p.id)}>
                      {t('inbox.reopen')}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {sorting && (
        <EntryForm
          kind={sorting.kind}
          source="mpesa"
          draft={{ shopId: sorting.payment.businessId, amountCents: sorting.payment.amountCents, method: 'mpesa' }}
          onSaved={(saved) => void assignPayment(sorting.payment.id, saved.entryId, person.id)}
          onClose={() => setSorting(null)}
        />
      )}
    </>
  )
}
