import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { loadAccounts, loadPrices, loadSubPayments, savePrice, setMustPay } from '../subscription/admin'
import type { AdminAccount, AdminPayment } from '../subscription/admin'
import { formatKes, periodTotal, PERIODS, planName } from '../subscription/pricing'
import type { Period, PriceRow } from '../subscription/pricing'
import { useToast } from '../toast'
import { useTimeFormat } from '../useTimeFormat'

type Part = 'accounts' | 'payments' | 'prices'

const periodWord: Record<Period, WordKey> = { daily: 'plan.daily', weekly: 'plan.weekly', monthly: 'plan.monthly' }
const statusWord: Record<AdminPayment['status'], WordKey> = {
  starting: 'admin.payPending',
  pending: 'admin.payPending',
  success: 'admin.paySuccess',
  failed: 'plan.failed',
  cancelled: 'plan.cancelled',
  timeout: 'plan.timeout',
  underpaid: 'plan.underpaid',
}
const statusTag = (s: AdminPayment['status']) =>
  s === 'success' ? 'tag tag-green' : s === 'underpaid' ? 'tag tag-red' : s === 'pending' || s === 'starting' ? 'tag tag-amber' : 'tag'

/** "254712345678" shown as "0712 345 678". */
const showPhone = (p: string) => (/^254\d{9}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p)

/** Super admin: who pays (with the "must pay" switch), every payment, and the price table. */
export function PlansAdmin() {
  const { t } = useI18n()
  const [part, setPart] = useState<Part>('accounts')
  const parts: { id: Part; label: WordKey }[] = [
    { id: 'accounts', label: 'admin.accounts' },
    { id: 'payments', label: 'admin.payments' },
    { id: 'prices', label: 'admin.prices' },
  ]
  return (
    <>
      <div className="segmented segmented-3 admin-parts" role="tablist">
        {parts.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={part === p.id} className={part === p.id ? 'segment segment-on' : 'segment'} onClick={() => setPart(p.id)}>
            {t(p.label)}
          </button>
        ))}
      </div>
      {part === 'accounts' && <Accounts />}
      {part === 'payments' && <Payments />}
      {part === 'prices' && <Prices />}
    </>
  )
}

// ---- Accounts -------------------------------------------------------------------------------

type AccountFilter = 'all' | 'paying' | 'free' | 'ended'

function Accounts() {
  const { t } = useI18n()
  const toast = useToast()
  const { dateTime } = useTimeFormat()
  const [rows, setRows] = useState<AdminAccount[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(() => {
    loadAccounts()
      .then((r) => {
        setRows(r)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const flip = async (a: AdminAccount) => {
    const mustPay = a.exempt // switching from free to paying, or the other way
    setSaving(a.owner_uid)
    setRows((rs) => rs?.map((r) => (r.owner_uid === a.owner_uid ? { ...r, exempt: !mustPay } : r)) ?? null)
    try {
      await setMustPay(a.owner_uid, mustPay)
      toast(t(mustPay ? 'admin.nowPaying' : 'admin.nowFree', { name: a.shop_names ?? a.email ?? '' }))
    } catch {
      toast(t('admin.saveFailed'))
      load()
    } finally {
      setSaving(null)
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter((a) => {
      if (filter === 'paying' && a.exempt) return false
      if (filter === 'free' && !a.exempt) return false
      if (filter === 'ended' && (a.exempt || a.active)) return false
      return !q || `${a.shop_names ?? ''} ${a.email ?? ''}`.toLowerCase().includes(q)
    })
  }, [rows, filter, query])

  if (failed) return <p className="warn-note" role="alert">{t('platform.failed')}</p>
  if (!rows) return <p className="plan-loading"><span className="spinner" aria-hidden /> {t('admin.loading')}</p>

  const count = (f: AccountFilter) =>
    rows.filter((a) => (f === 'all' ? true : f === 'paying' ? !a.exempt : f === 'free' ? a.exempt : !a.exempt && !a.active)).length
  const filters: { id: AccountFilter; label: WordKey }[] = [
    { id: 'all', label: 'admin.fAll' },
    { id: 'paying', label: 'admin.fPaying' },
    { id: 'free', label: 'admin.fFree' },
    { id: 'ended', label: 'admin.fEnded' },
  ]

  const standing = (a: AdminAccount) => {
    const date = dateTime(Date.parse(a.expires_at))
    if (a.exempt) return { text: t('admin.free'), tag: 'tag tag-green' }
    if (!a.active) return { text: t('admin.endedOn', { date }), tag: 'tag tag-red' }
    if (a.in_trial) return { text: t('admin.trialUntil', { date }), tag: 'tag tag-amber' }
    return { text: t('admin.paidUntil', { date }), tag: 'tag' }
  }

  return (
    <>
      <p className="card-note platform-note">{t('admin.accountsNote')}</p>
      <label className="search-box">
        <Search size={20} aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.search')} aria-label={t('admin.search')} />
      </label>
      <div className="chips platform-filter">
        {filters.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'chip chip-on' : 'chip'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {t(f.label)} ({count(f.id)})
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="hint-note">{t('admin.noAccounts')}</p>}
      <div className="list">
        {shown.map((a) => {
          const s = standing(a)
          return (
            <div key={a.owner_uid} className="worker-card account-row">
              <span className="list-main">
                <span className="list-title">{a.shop_names ?? '?'}</span>
                <span className="list-sub">{a.email}</span>
                <span className="list-sub">
                  <span className={s.tag}>{s.text}</span>{' '}
                  {t('admin.shopsAndPlan', { n: a.shop_count, plan: t(`plan.${planName(a.shop_count)}` as WordKey) })}
                </span>
              </span>
              <span className="switch-wrap">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!a.exempt}
                  aria-label={t('admin.mustPayFor', { name: a.shop_names ?? a.email ?? '' })}
                  className={a.exempt ? 'switch' : 'switch switch-on'}
                  disabled={saving === a.owner_uid}
                  onClick={() => void flip(a)}
                >
                  <span className="switch-knob" />
                </button>
                <span className="switch-label">{t(a.exempt ? 'admin.free' : 'admin.mustPay')}</span>
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---- Payments -------------------------------------------------------------------------------

type PayFilter = 'all' | 'paid' | 'unpaid' | 'check'

function Payments() {
  const { t } = useI18n()
  const { dateTime } = useTimeFormat()
  const [rows, setRows] = useState<AdminPayment[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<PayFilter>('all')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    loadSubPayments()
      .then(setRows)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="warn-note" role="alert">{t('platform.failed')}</p>
  if (!rows) return <p className="plan-loading"><span className="spinner" aria-hidden /> {t('admin.loading')}</p>

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const paidThisMonth = rows.filter((p) => p.status === 'success' && Date.parse(p.created_at) >= monthStart.getTime())
  const received = paidThisMonth.reduce((sum, p) => sum + (p.paid_amount_kes ?? p.amount_kes), 0)
  const needCheck = rows.filter((p) => p.status === 'underpaid').length

  const shown = rows.filter((p) =>
    filter === 'all' ? true : filter === 'paid' ? p.status === 'success' : filter === 'check' ? p.status === 'underpaid' : p.status !== 'success',
  )
  const filters: { id: PayFilter; label: string }[] = [
    { id: 'all', label: t('admin.fAll') },
    { id: 'paid', label: t('admin.fPaid') },
    { id: 'unpaid', label: t('admin.fUnpaid') },
    { id: 'check', label: `${t('admin.fCheck')} (${needCheck})` },
  ]

  return (
    <>
      <section className="totals">
        <div className="total-card">
          <span className="total-label">{t('admin.thisMonth')}</span>
          <span className="total-value">{formatKes(received)}</span>
          <span className="list-sub">{t('admin.paymentsN', { n: paidThisMonth.length })}</span>
        </div>
      </section>
      <div className="chips platform-filter">
        {filters.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'chip chip-on' : 'chip'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="hint-note">{t('admin.noPayments')}</p>}
      <div className="list">
        {shown.map((p) => (
          <div key={p.id} className="worker-card">
            <button type="button" className="pay-row" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="list-main">
                <span className="list-title">{p.shop_names ?? '?'}</span>
                <span className="list-sub">
                  {p.period ? t(periodWord[p.period]) : t('plan.addOnlyShort')} · {t('plan.shopsN', { n: p.shops })} · {showPhone(p.phone)}
                </span>
                <span className="list-sub">
                  {dateTime(Date.parse(p.created_at))}
                  {p.environment === 'sandbox' && <span className="tag"> {t('admin.test')}</span>}
                </span>
              </span>
              <span className="pay-right">
                <b>{formatKes(p.amount_kes)}</b>
                <span className={statusTag(p.status)}>{t(statusWord[p.status])}</span>
              </span>
            </button>
            {open === p.id && (
              <div className="pay-detail">
                {p.mpesa_receipt && <p>{t('plan.receipt', { code: p.mpesa_receipt })}</p>}
                {p.paid_amount_kes !== null && p.paid_amount_kes !== p.amount_kes && (
                  <p className="ink-red">{t('admin.paidAmount', { amount: formatKes(p.paid_amount_kes) })}</p>
                )}
                {p.expires_after && <p>{t('admin.extendedTo', { date: dateTime(Date.parse(p.expires_after)) })}</p>}
                {p.result_desc && <p className="list-sub">Safaricom: {p.result_desc}{p.result_code !== null ? ` (${p.result_code})` : ''}</p>}
                {p.raw_callback !== null && p.raw_callback !== undefined && (
                  <details>
                    <summary>{t('admin.raw')}</summary>
                    <pre className="order-text">{JSON.stringify(p.raw_callback, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ---- Prices ---------------------------------------------------------------------------------

function Prices() {
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<PriceRow[] | null>(null)
  const [draft, setDraft] = useState<Record<string, { base: string; addon: string }>>({})
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<Period | null>(null)

  useEffect(() => {
    loadPrices()
      .then((r) => {
        const sorted = PERIODS.map((p) => r.find((x) => x.period === p)!).filter(Boolean)
        setRows(sorted)
        setDraft(Object.fromEntries(sorted.map((p) => [p.period, { base: String(p.base_kes), addon: String(p.addon_kes) }])))
      })
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="warn-note" role="alert">{t('platform.failed')}</p>
  if (!rows) return <p className="plan-loading"><span className="spinner" aria-hidden /> {t('admin.loading')}</p>

  const num = (s: string) => (/^\d{1,7}$/.test(s.trim()) ? Number(s.trim()) : null)

  const save = async (p: PriceRow) => {
    const base = num(draft[p.period].base)
    const addon = num(draft[p.period].addon)
    if (base === null || addon === null || base < 1) return
    setSaving(p.period)
    try {
      await savePrice(p.period, base, addon)
      setRows(rows.map((r) => (r.period === p.period ? { ...r, base_kes: base, addon_kes: addon } : r)))
      toast(t('admin.priceSaved'))
    } catch {
      toast(t('admin.saveFailed'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <p className="card-note platform-note">{t('admin.pricesNote')}</p>
      {rows.map((p) => {
        const d = draft[p.period]
        const base = num(d.base)
        const addon = num(d.addon)
        const ok = base !== null && addon !== null && base >= 1
        const changed = ok && (base !== p.base_kes || addon !== p.addon_kes)
        return (
          <section key={p.period} className="card">
            <h2 className="card-title">{t(periodWord[p.period])} · {t('admin.days', { n: p.days })}</h2>
            <div className="price-pair">
              <label className="field">
                <span>{t('admin.base')}</span>
                <input inputMode="numeric" value={d.base} onChange={(e) => setDraft({ ...draft, [p.period]: { ...d, base: e.target.value } })} />
              </label>
              <label className="field">
                <span>{t('admin.addon')}</span>
                <input inputMode="numeric" value={d.addon} onChange={(e) => setDraft({ ...draft, [p.period]: { ...d, addon: e.target.value } })} />
              </label>
            </div>
            {ok ? (
              <p className="card-note">
                {t('admin.example', {
                  one: formatKes(periodTotal({ ...p, base_kes: base, addon_kes: addon }, 1)),
                  three: formatKes(periodTotal({ ...p, base_kes: base, addon_kes: addon }, 3)),
                })}
              </p>
            ) : (
              <p className="field-error">{t('admin.priceBad')}</p>
            )}
            <button type="button" className="btn btn-primary" disabled={!changed || saving === p.period} onClick={() => void save(p)}>
              {t('common.save')}
            </button>
          </section>
        )
      })}
    </>
  )
}
