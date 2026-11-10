import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CustomerForm } from '../components/CustomerForm'
import { useBalanceText } from '../components/CustomerPicker'
import { EmptyState } from '../components/EmptyState'
import { db } from '../db'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { useCustomers } from '../useCustomers'

/** Who owes how much. The owner also sees which worker gave the credit. */
export function DebtsScreen() {
  const { t } = useI18n()
  const { dir, shops, isAdmin } = useSession()
  const { list } = useCustomers()
  const balanceText = useBalanceText()
  const [adding, setAdding] = useState(false)

  const shopIds = shops.map((s) => s.id)
  // For the owner: the names of the people who gave each customer credit.
  const givers = useLiveQuery(async () => {
    const byCustomer = new Map<string, Set<string>>()
    if (!isAdmin) return byCustomer
    const credits = await db.entries.where('businessId').anyOf(shopIds).filter((e) => e.kind === 'credit' && !e.cancelled).toArray()
    for (const e of credits) {
      if (!e.customerId) continue
      if (!byCustomer.has(e.customerId)) byCustomer.set(e.customerId, new Set())
      byCustomer.get(e.customerId)?.add(e.createdBy)
    }
    return byCustomer
  }, [shopIds.join(), isAdmin])

  // Biggest debts first, then everyone who is paid up.
  const customers = list && [...list].sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name))
  const totalOwed = (list ?? []).reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0)

  return (
    <>
      <h1 className="screen-title">{t('nav.debts')}</h1>

      {customers &&
        (customers.length === 0 ? (
          <EmptyState icon={<Users size={40} />} title={t('debts.empty')} hint={t('debts.emptyHint')} />
        ) : (
          <>
            <div className="total-card owed-card">
              <span className="total-label">{t('debts.total')}</span>
              <span className={`total-value ${totalOwed > 0 ? 'ink-amber' : ''}`}>{formatKsh(totalOwed)}</span>
            </div>
            <div className="list list-gap">
              {customers.map((c) => {
                const names = [...(givers?.get(c.id) ?? [])]
                  .map((id) => dir.people.find((p) => p.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')
                const shop = shops.length > 1 ? dir.businesses.find((b) => b.id === c.businessId)?.name : undefined
                const sub = [c.balanceCents > 0 && names ? t('debts.givenBy', { names }) : null, shop].filter(Boolean).join(' · ')
                return (
                  <Link key={c.id} to={`/debts/${c.id}`} className="list-row">
                    <span className="avatar" aria-hidden>
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="list-main">
                      <span className="list-title">{c.name}</span>
                      {sub && <span className="list-sub">{sub}</span>}
                    </span>
                    <span className="row-end">
                      <span className={`row-amount ${c.balanceCents > 0 ? 'ink-amber' : 'ink-dim'}`}>
                        {c.balanceCents > 0 ? formatKsh(c.balanceCents) : balanceText(c)}
                      </span>
                    </span>
                    <ChevronRight size={20} aria-hidden />
                  </Link>
                )
              })}
            </div>
          </>
        ))}

      <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
        <Plus size={22} aria-hidden /> {t('debts.add')}
      </button>

      {adding && <CustomerForm onClose={() => setAdding(false)} />}
    </>
  )
}
