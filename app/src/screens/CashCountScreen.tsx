import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { cashMovements, expectedCash, parseCash, recentCounts, saveCashCount } from '../cash'
import { useI18n } from '../i18n'
import { startOfDay } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useToast } from '../toast'
import { useTimeFormat } from '../useTimeFormat'

/** Count the till at the end of the day and see whether it matches the ledger. */
export function CashCountScreen() {
  const { t } = useI18n()
  const toast = useToast()
  const { dir, person, shops } = useSession()
  const { dateTime } = useTimeFormat()
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const [opening, setOpening] = useState<string | null>(null)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [compared, setCompared] = useState(false)
  const [bad, setBad] = useState(false)
  const [saving, setSaving] = useState(false)

  const shopIds = shops.map((s) => s.id)
  const history = useLiveQuery(() => recentCounts(shopIds), [shopIds.join()])
  // The cash left in the till at the last count is the starting point, and only cash moved
  // since then is added to it. With no earlier count, the day starts from what is typed in.
  const lastForShop = history?.find((c) => c.businessId === shopId)
  const since = lastForShop?.at ?? startOfDay(Date.now())
  const movements = useLiveQuery(() => cashMovements(shopId, since, Date.now()), [shopId, since, compared])

  if (!person) return null

  const openingText = opening ?? (lastForShop ? String(lastForShop.countedCents / 100) : '')
  const openingCents = parseCash(openingText)
  const countedCents = counted.trim() === '' ? null : parseCash(counted)

  const compare = (e: FormEvent) => {
    e.preventDefault()
    if (openingCents === null || countedCents === null) {
      setBad(true)
      return
    }
    setCompared(true)
  }

  const expected = movements && openingCents !== null ? expectedCash(openingCents, movements) : null
  const gap = expected !== null && countedCents !== null ? countedCents - expected : null

  const save = async () => {
    if (saving || !movements || openingCents === null || countedCents === null || expected === null) return
    setSaving(true)
    try {
      await saveCashCount({
        businessId: shopId,
        openingCents,
        expectedCents: expected,
        countedCents,
        note: note.trim() || undefined,
        byPersonId: person.id,
      })
      toast(t('entry.saved'))
      setCompared(false)
      setCounted('')
      setNote('')
      setOpening(null)
    } finally {
      setSaving(false)
    }
  }

  const gapWords = (cents: number) =>
    cents === 0 ? t('cash.balanced') : cents < 0 ? t('cash.short', { amount: formatKsh(-cents) }) : t('cash.over', { amount: formatKsh(cents) })
  const gapClass = (cents: number) => (cents === 0 ? 'money-in' : cents < 0 ? 'money-out' : 'ink-amber')

  return (
    <>
      <h1 className="screen-title">{t('cash.title')}</h1>

      {shops.length > 1 && (
        <div className="chips platform-filter">
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === shopId ? 'chip chip-on' : 'chip'}
              aria-pressed={s.id === shopId}
              onClick={() => {
                setShopId(s.id)
                setCompared(false)
                setOpening(null)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <form className="card" onSubmit={compare}>
        <label className="field">
          <span>{t('cash.opening')}</span>
          <input
            value={openingText}
            onChange={(e) => {
              setOpening(e.target.value)
              setCompared(false)
              setBad(false)
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
          />
        </label>
        <label className="field">
          <span>{t('cash.counted')}</span>
          <input
            className="amount-input"
            value={counted}
            onChange={(e) => {
              setCounted(e.target.value)
              setCompared(false)
              setBad(false)
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
          />
          <small>{t('cash.hint')}</small>
          <small>{lastForShop ? t('cash.sinceLast', { when: dateTime(lastForShop.at) }) : t('cash.sinceMorning')}</small>
        </label>
        {bad && (
          <p className="field-error" role="alert">
            {t('cash.bad')}
          </p>
        )}
        {!compared && (
          <button type="submit" className="btn btn-primary">
            {t('cash.compare')}
          </button>
        )}
      </form>

      {compared && movements && expected !== null && gap !== null && openingCents !== null && countedCents !== null && (
        <section className="card card-gap">
          <table className="compare cash-sum">
            <tbody>
              <tr>
                <th scope="row">{t('cash.opening')}</th>
                <td>{formatKsh(openingCents)}</td>
              </tr>
              <tr>
                <th scope="row">+ {t('cash.sales')}</th>
                <td>{formatKsh(movements.salesCents)}</td>
              </tr>
              <tr>
                <th scope="row">+ {t('cash.payments')}</th>
                <td>{formatKsh(movements.paymentsCents)}</td>
              </tr>
              <tr>
                <th scope="row">− {t('cash.expenses')}</th>
                <td>{formatKsh(movements.expensesCents)}</td>
              </tr>
              <tr className="cash-strong">
                <th scope="row">{t('cash.expected')}</th>
                <td>{formatKsh(expected)}</td>
              </tr>
              <tr className="cash-strong">
                <th scope="row">{t('cash.countedShort')}</th>
                <td>{formatKsh(countedCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className={`cash-gap ${gapClass(gap)}`} role="status">
            {gapWords(gap)}
          </p>
          <label className="field">
            <span>{t('entry.note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" />
          </label>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {t('cash.save')}
          </button>
        </section>
      )}

      {history && history.length > 0 && (
        <section className="history">
          <h3>{t('cash.history')}</h3>
          <div className="list">
            {history.map((c) => (
              <div key={c.id} className="list-row">
                <span className="list-main">
                  <span className="list-title">{formatKsh(c.countedCents)}</span>
                  <span className="list-sub">
                    {[
                      dateTime(c.at),
                      dir.people.find((p) => p.id === c.byPersonId)?.name,
                      shops.length > 1 ? dir.businesses.find((b) => b.id === c.businessId)?.name : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {c.note && <span className="list-sub">{c.note}</span>}
                </span>
                <span className={`row-amount ${gapClass(c.gapCents)}`}>{gapWords(c.gapCents)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
