import { useLiveQuery } from 'dexie-react-hooks'
import { Printer, Share2 } from 'lucide-react'
import { useState } from 'react'
import { bizTypeLabel } from '../bizTypes'
import { healthReport } from '../health'
import type { Steadiness } from '../health'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'

const steadyWords: Record<Steadiness, WordKey> = {
  steady: 'health.steady',
  fair: 'health.fair',
  uneven: 'health.uneven',
  unknown: 'health.unknown',
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** Owner only: a one-page picture of the business to share with a bank, Sacco or lender. */
export function HealthReportScreen() {
  const { t, lang } = useI18n()
  const { dir, person, shops } = useSession()
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const report = useLiveQuery(() => healthReport(shopId, Date.now()), [shopId])
  const shop = dir.businesses.find((b) => b.id === shopId)

  if (!person || !shop) return null

  // Under 30 days of records the figures are plain totals, not monthly averages.
  const salesLabel: WordKey = report?.scaled === false ? 'health.totalSales' : 'health.avgSales'
  const expensesLabel: WordKey = report?.scaled === false ? 'health.totalExpenses' : 'health.avgExpenses'

  const locale = lang === 'sw' ? 'sw-KE' : 'en-KE'
  const date = (ms: number) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(ms)
  const monthName = (ms: number) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(ms)

  const share = async () => {
    if (!report) return
    const text = [
      `${shop.name}: ${t('health.title')}`,
      t('health.period', { from: date(report.from), to: date(report.to), days: report.daysOfRecords }),
      `${t(salesLabel)}: ${formatKsh(report.avgMonthlySalesCents)}`,
      `${t(expensesLabel)}: ${formatKsh(report.avgMonthlyExpensesCents)}`,
      `${t('health.steadiness')}: ${t(steadyWords[report.steadiness])}`,
      t('health.disclaimer'),
    ].join('\n')
    try {
      await navigator.share({ title: `${shop.name}: ${t('health.title')}`, text })
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }

  return (
    <>
      <div className="no-print">
        <h1 className="screen-title">{t('health.title')}</h1>
        {shops.length > 1 && (
          <div className="chips platform-filter">
            {shops.map((s) => (
              <button key={s.id} type="button" className={s.id === shopId ? 'chip chip-on' : 'chip'} aria-pressed={s.id === shopId} onClick={() => setShopId(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <p className="card-note report-intro">{t('health.intro')}</p>
      </div>

      {report && (
        <article className="report">
          <header>
            <p className="report-kicker">{t('health.title')}</p>
            <h2>{shop.name}</h2>
            <p>
              {[t(bizTypeLabel(shop.type)), person.name, person.phone].filter(Boolean).join(' · ')}
            </p>
            <p>{t('health.period', { from: date(report.from), to: date(report.to), days: report.daysOfRecords })}</p>
          </header>

          {report.entries === 0 ? (
            <p className="report-empty">{t('health.empty')}</p>
          ) : (
            <>
              {report.daysOfRecords < 30 && <p className="warn-note">{t('health.short', { days: report.daysOfRecords })}</p>}

              <section className="report-figures">
                <div>
                  <span>{t(salesLabel)}</span>
                  <b>{formatKsh(report.avgMonthlySalesCents)}</b>
                </div>
                <div>
                  <span>{t(expensesLabel)}</span>
                  <b>{formatKsh(report.avgMonthlyExpensesCents)}</b>
                </div>
                <div>
                  <span>{t('health.avgLeft')}</span>
                  <b>{formatKsh(report.avgMonthlySalesCents - report.avgMonthlyExpensesCents)}</b>
                </div>
              </section>

              <table className="compare report-table">
                <tbody>
                  <tr>
                    <th scope="row">{t('health.profit')}</th>
                    <td>
                      {report.margin === null
                        ? t('health.profitUnknown')
                        : t('health.profitValue', { margin: percent(report.margin), coverage: percent(report.marginCoverage) })}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.steadiness')}</th>
                    <td>
                      {t(steadyWords[report.steadiness])}
                      {report.steadiness !== 'unknown' && ` (${t('health.weeks', { n: report.weeks })})`}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.daysTraded')}</th>
                    <td>{t('health.daysTradedValue', { traded: report.daysTraded, days: report.daysOfRecords })}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.mpesaShare')}</th>
                    <td>{percent(report.mpesaShare)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.creditShare')}</th>
                    <td>{percent(report.creditShare)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('debts.total')}</th>
                    <td>{formatKsh(report.owedByCustomersCents)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.owesSuppliers')}</th>
                    <td>{formatKsh(report.owedToSuppliersCents)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('health.records')}</th>
                    <td>{t('health.recordsValue', { n: report.entries, edited: report.edited, deleted: report.deleted })}</td>
                  </tr>
                </tbody>
              </table>

              <h3>{t('health.byMonth')}</h3>
              <table className="compare report-table">
                <thead>
                  <tr>
                    <th scope="col">{t('health.month')}</th>
                    <th scope="col">{t('analysis.sales')}</th>
                    <th scope="col">{t('entry.expense')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.start}>
                      <th scope="row">
                        {monthName(m.start)}
                        {!m.complete && ` (${t('health.partMonth')})`}
                      </th>
                      <td>{formatKsh(m.salesCents)}</td>
                      <td>{formatKsh(m.expensesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <footer>{t('health.disclaimer')}</footer>
        </article>
      )}

      {report && report.entries > 0 && (
        <div className="no-print">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <Printer size={22} aria-hidden /> {t('health.print')}
          </button>
          {typeof navigator.share === 'function' && (
            <button type="button" className="btn btn-quiet" onClick={() => void share()}>
              <Share2 size={20} aria-hidden /> {t('health.share')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
