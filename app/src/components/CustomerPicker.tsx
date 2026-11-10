import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { addCustomer } from '../customers'
import { db } from '../db'
import type { Customer } from '../db'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'

/** What a customer owes, in words. */
export function useBalanceText() {
  const { t } = useI18n()
  return (c: Pick<Customer, 'balanceCents'>) =>
    c.balanceCents > 0
      ? t('debts.owes', { amount: formatKsh(c.balanceCents) })
      : c.balanceCents < 0
        ? t('debts.ahead', { amount: formatKsh(-c.balanceCents) })
        : t('debts.paidUp')
}

/**
 * Choose who the credit or payment is for: type a name, tap a match,
 * or add the typed name as a new customer on the spot.
 */
export function CustomerPicker({
  shopId,
  value,
  locked = false,
  onChange,
}: {
  shopId: string
  value: Customer | null
  /** True when the customer cannot be changed (editing an entry, or opened from a customer's page). */
  locked?: boolean
  onChange: (customer: Customer | null) => void
}) {
  const { t } = useI18n()
  const balanceText = useBalanceText()
  const [search, setSearch] = useState('')

  const customers = useLiveQuery(
    async () => (await db.customers.where('businessId').equals(shopId).toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    [shopId],
  )

  if (value) {
    return (
      <div className="field">
        <span>{t('entry.customer')}</span>
        <div className="picked">
          <span className="list-main">
            <span className="picker-name">{value.name}</span>
            <span className="list-sub">{balanceText(value)}</span>
          </span>
          {!locked && (
            <button type="button" className="link-btn" onClick={() => onChange(null)}>
              {t('entry.change')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const typed = search.trim()
  const wanted = typed.toLowerCase()
  const matches = (customers ?? []).filter((c) => !wanted || c.name.toLowerCase().includes(wanted))
  const exact = (customers ?? []).some((c) => c.name.toLowerCase() === wanted)

  const createNew = async () => {
    const id = await addCustomer(shopId, { name: typed })
    const created = await db.customers.get(id)
    if (created) onChange(created)
    setSearch('')
  }

  return (
    <div className="field">
      <span>{t('entry.customer')}</span>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('entry.customerSearch')}
        aria-label={t('entry.customerSearch')}
        maxLength={60}
        autoComplete="off"
        autoFocus
      />
      <div className="picker">
        {matches.slice(0, 6).map((c) => (
          <button key={c.id} type="button" className="picker-row" onClick={() => onChange(c)}>
            <span className="list-main">
              <span className="picker-name">{c.name}</span>
              <span className="list-sub">{balanceText(c)}</span>
            </span>
          </button>
        ))}
        {typed && !exact && (
          <button type="button" className="picker-row picker-new" onClick={createNew}>
            <span className="picker-plus" aria-hidden>
              +
            </span>
            <span className="picker-name">{t('entry.customerNew', { name: typed })}</span>
          </button>
        )}
      </div>
    </div>
  )
}
