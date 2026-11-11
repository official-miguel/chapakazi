import { useLiveQuery } from 'dexie-react-hooks'
import { Square, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { analyse, periodRange } from '../analysis'
import type { Analysis, Period, Seller } from '../analysis'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { formatQty, unitName } from '../units'

const periods: { id: Period; label: WordKey }[] = [
  { id: 'today', label: 'day.today' },
  { id: 'week', label: 'analysis.week' },
  { id: 'month', label: 'analysis.month' },
]

const weekdays: WordKey[] = ['wd.mon', 'wd.tue', 'wd.wed', 'wd.thu', 'wd.fri', 'wd.sat', 'wd.sun']

/** A ranked list with one thin bar per row. The number sits beside its bar, so no legend is needed. */
function RankBars({ rows }: { rows: { key: string; label: string; detail: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="rank">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="rank-label">{r.label}</span>
          <span className="rank-value">{r.text}</span>
          <span className="rank-detail">{r.detail}</span>
          <span className="rank-track" aria-hidden>
            <span className="rank-fill" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Thin columns for "when is the shop busy". Tap a column to read its value; the busiest shows by default. */
function Columns({ values, labels, names }: { values: number[]; labels: (string | null)[]; names: string[] }) {
  const { t } = useI18n()
  const max = Math.max(...values)
  const peak = values.indexOf(max)
  const [picked, setPicked] = useState<number | null>(null)
  const shown = picked ?? peak
  if (max <= 0) return <p className="hint-note">{t('analysis.noSales')}</p>

  return (
    <>
      <p className="chart-readout" role="status">
        {picked === null ? `${t('analysis.busiest')}: ` : ''}
        <b>{names[shown]}</b> · {formatKsh(values[shown])}
      </p>
      <div className="columns">
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            className={i === shown ? 'column column-on' : 'column'}
            aria-label={`${names[i]}: ${formatKsh(v)}`}
            aria-pressed={i === picked}
            onClick={() => setPicked(i === picked ? null : i)}
          >
            <span className="column-bar" style={{ height: `${v > 0 ? Math.max(3, (v / max) * 100) : 0}%` }} />
          </button>
        ))}
      </div>
      <div className="columns-axis" aria-hidden>
        {labels.map((label, i) => (
          <span key={i}>{label ?? ''}</span>
        ))}
      </div>
    </>
  )
}

/** Owner only: how the business is doing today, this week and this month. */
export function AnalysisScreen() {
  const { t, lang } = useI18n()
  const { dir, shops } = useSession()
  const [period, setPeriod] = useState<Period>('today')
  const [speaking, setSpeaking] = useState(false)

  const shopIds = shops.map((s) => s.id)
  const now = Date.now()
  const [from, to] = periodRange(period, now)
  const data = useLiveQuery(() => analyse(shopIds, from, to), [shopIds.join(), from, to])
  const [todayFrom, todayTo] = periodRange('today', now)
  const today = useLiveQuery(() => analyse(shopIds, todayFrom, todayTo), [shopIds.join(), todayFrom, todayTo])

  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  /** Today in plain words. `money` decides how amounts are written: for the eye, or for the ear. */
  const summary = (a: Analysis, money: (cents: number) => string): string[] => {
    const lines: string[] = []
    if (a.salesCount === 0) lines.push(t('sum.noSales'))
    else {
      lines.push(t(a.salesCount === 1 ? 'sum.salesOne' : 'sum.sales', { amount: money(a.salesCents), n: a.salesCount }))
      if (a.creditCents > 0) lines.push(t('sum.credit', { amount: money(a.creditCents) }))
      if (a.best[0]) lines.push(t('sum.best', { name: a.best[0].name }))
    }
    if (a.paymentsCents > 0) lines.push(t('sum.payments', { amount: money(a.paymentsCents) }))
    if (a.expensesCents > 0) lines.push(t('sum.expenses', { amount: money(a.expensesCents) }))
    if (a.lowStock > 0) lines.push(t(a.lowStock === 1 ? 'sum.lowOne' : 'sum.low', { n: a.lowStock }))
    if (a.owedCents > 0) lines.push(t('sum.owed', { amount: money(a.owedCents) }))
    if (a.owedToSuppliersCents > 0) lines.push(t('sum.owedSuppliers', { amount: money(a.owedToSuppliersCents) }))
    return lines
  }

  const readAloud = () => {
    if (!today || !window.speechSynthesis) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    // "KSh 1,350" is read out badly, so amounts are spoken as "1350 shillings".
    const spoken = summary(today, (cents) => t('sum.money', { n: Math.round(cents / 100) })).join(' ')
    const speech = new SpeechSynthesisUtterance(spoken)
    speech.lang = lang === 'sw' ? 'sw-KE' : 'en-KE'
    speech.onend = () => setSpeaking(false)
    speech.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(speech)
    setSpeaking(true)
  }

  const sellerRows = (list: Seller[]) =>
    list.map((s) => ({
      key: s.itemId,
      label: s.name,
      detail: `${formatQty(s.qty)} ${unitName(t, s.unit)}`,
      value: s.valueCents,
      text: formatKsh(s.valueCents),
    }))

  // Show only the hours the shop is plausibly open, widened to include any sale outside them.
  const hours = data?.byHour ?? []
  const firstHour = Math.min(6, ...hours.map((v, h) => (v > 0 ? h : 24)))
  const lastHour = Math.max(21, ...hours.map((v, h) => (v > 0 ? h : 0)))
  const hourRange = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i)

  return (
    <>
      <h1 className="screen-title">{t('analysis.title')}</h1>

      {today && (
        <section className="card">
          <h2 className="card-title">{t('analysis.summary')}</h2>
          <p className="summary-text">{summary(today, formatKsh).join(' ')}</p>
          {typeof window !== 'undefined' && window.speechSynthesis && (
            <button type="button" className="btn btn-quiet" onClick={readAloud}>
              {speaking ? <Square size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
              {t(speaking ? 'voice.stop' : 'analysis.readAloud')}
            </button>
          )}
        </section>
      )}

      <div className="segmented segmented-3" role="tablist">
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            className={period === p.id ? 'segment segment-on' : 'segment'}
            onClick={() => setPeriod(p.id)}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {data && (
        <>
          <section className="totals">
            <div className="total-card">
              <span className="total-label">{t('analysis.sales')}</span>
              <span className="total-value money-in">{formatKsh(data.salesCents)}</span>
              <span className="list-sub">{t('analysis.salesCount', { n: data.salesCount })}</span>
            </div>
            <div className="total-card">
              <span className="total-label">{t('entry.expense')}</span>
              <span className="total-value money-out">{formatKsh(data.expensesCents)}</span>
              <span className="list-sub">
                {t('analysis.left', { amount: formatKsh(data.salesCents - data.expensesCents) })}
              </span>
            </div>
          </section>

          <section className="card card-gap">
            <h2 className="card-title">{t('analysis.profit')}</h2>
            {data.itemProfitCents === null ? (
              <p className="summary-text">{t('analysis.profitNone')}</p>
            ) : (
              <>
                <p className={`total-value ${data.itemProfitCents >= 0 ? 'money-in' : 'money-out'}`}>
                  {formatKsh(data.itemProfitCents)}
                </p>
                <p className="card-note">
                  {data.profitCoverage >= 0.995
                    ? t('analysis.profitFull')
                    : t('analysis.profitPart', { percent: Math.round(data.profitCoverage * 100) })}
                </p>
              </>
            )}
          </section>

          <section className="card card-gap">
            <h2 className="card-title">{t('analysis.best')}</h2>
            {data.best.length === 0 ? <p className="hint-note">{t('analysis.noItems')}</p> : <RankBars rows={sellerRows(data.best)} />}
          </section>

          {data.slowest.length > 0 && data.best.length > 0 && (
            <section className="card card-gap">
              <h2 className="card-title">{t('analysis.slowest')}</h2>
              <RankBars rows={sellerRows(data.slowest)} />
            </section>
          )}

          <section className="card card-gap">
            <h2 className="card-title">{t('analysis.hours')}</h2>
            <Columns
              key={`hours-${period}`}
              values={hourRange.map((h) => data.byHour[h])}
              labels={hourRange.map((h) => (h % 3 === 0 ? String(h) : null))}
              names={hourRange.map((h) => `${h}:00`)}
            />
          </section>

          {period !== 'today' && (
            <section className="card card-gap">
              <h2 className="card-title">{t('analysis.days')}</h2>
              <Columns
                key={`days-${period}`}
                values={data.byWeekday}
                labels={weekdays.map((d) => t(d))}
                names={weekdays.map((d) => t(d))}
              />
            </section>
          )}

          {data.perShop.length > 1 && (
            <section className="card card-gap">
              <h2 className="card-title">{t('analysis.compare')}</h2>
              <table className="compare">
                <thead>
                  <tr>
                    <th scope="col">{t('more.businesses')}</th>
                    <th scope="col">{t('analysis.sales')}</th>
                    <th scope="col">{t('entry.expense')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perShop.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">{dir.businesses.find((b) => b.id === s.id)?.name}</th>
                      <td>{formatKsh(s.salesCents)}</td>
                      <td>{formatKsh(s.expensesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="card card-gap">
            <h2 className="card-title">{t('debts.total')}</h2>
            <p className={`total-value ${data.owedCents > 0 ? 'ink-amber' : ''}`}>{formatKsh(data.owedCents)}</p>
          </section>

          <section className="card card-gap">
            <h2 className="card-title">{t('sup.youOwe')}</h2>
            <p className={`total-value ${data.owedToSuppliersCents > 0 ? 'ink-amber' : ''}`}>{formatKsh(data.owedToSuppliersCents)}</p>
          </section>
        </>
      )}
    </>
  )
}
