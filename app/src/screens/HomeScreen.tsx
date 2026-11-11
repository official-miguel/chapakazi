import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Eye, HandCoins, PackageOpen, Receipt, ShoppingBag, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EntryDetail } from '../components/EntryDetail'
import { EntryForm } from '../components/EntryForm'
import { EntryRow } from '../components/EntryRow'
import { db } from '../db'
import type { EntryKind } from '../db'
import { useI18n } from '../i18n'
import { addDays, entriesBetween, startOfDay, totals } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { needsRestock } from '../stock'
import { useCustomers } from '../useCustomers'

const RECENT = 4

export function HomeScreen() {
  const { t } = useI18n()
  const { shops, isAdmin } = useSession()
  const { byId: customers } = useCustomers()
  const [adding, setAdding] = useState<EntryKind | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const shopIds = shops.map((s) => s.id)
  const today = startOfDay(Date.now())
  const entries = useLiveQuery(() => entriesBetween(shopIds, today, addDays(today, 1)), [shopIds.join(), today])
  const live = (entries ?? []).filter((e) => !e.cancelled)
  const sums = totals(live)

  const unseenAlerts = useLiveQuery(
    async () => (isAdmin ? (await db.alerts.where('businessId').anyOf(shopIds).toArray()).filter((a) => !a.seenAt).length : 0),
    [shopIds.join(), isAdmin],
  )

  // M-Pesa money that has arrived but nobody has yet said what it was for.
  const unsorted = useLiveQuery(async () => {
    const waiting = (await db.mpesaPayments.where('businessId').anyOf(shopIds).toArray()).filter((p) => p.status === 'unassigned')
    return { count: waiting.length, cents: waiting.reduce((sum, p) => sum + p.amountCents, 0) }
  }, [shopIds.join()])

  const lowStock = useLiveQuery(
    async () => (await db.items.where('businessId').anyOf(shopIds).toArray()).filter((i) => !i.archived && needsRestock(i)).length,
    [shopIds.join()],
  )

  return (
    <>
      <h1 className="screen-title">{t('home.today')}</h1>

      <section className="totals">
        <div className="total-card">
          <span className="total-label">
            <ArrowDownLeft size={16} aria-hidden /> {t('home.moneyIn')}
          </span>
          <span className="total-value money-in">{formatKsh(sums.inCents)}</span>
        </div>
        <div className="total-card">
          <span className="total-label">
            <ArrowUpRight size={16} aria-hidden /> {t('home.moneyOut')}
          </span>
          <span className="total-value money-out">{formatKsh(sums.outCents)}</span>
        </div>
      </section>

      {isAdmin && (
        <Link to="/analysis" className="see-more">
          {t('analysis.title')} <ChevronRight size={18} aria-hidden />
        </Link>
      )}

      {!!unseenAlerts && (
        <Link to="/alerts" className="list-row alert-row">
          <Eye size={22} aria-hidden />
          <span className="list-main">
            <span className="list-title">
              {t('alerts.title')} ({unseenAlerts})
            </span>
          </span>
          <ChevronRight size={22} aria-hidden />
        </Link>
      )}

      {!!unsorted?.count && (
        <Link to="/inbox" className="list-row alert-row">
          <Smartphone size={22} aria-hidden />
          <span className="list-main">
            <span className="list-title">{t('inbox.homeCard', { n: unsorted.count, amount: formatKsh(unsorted.cents) })}</span>
          </span>
          <ChevronRight size={22} aria-hidden />
        </Link>
      )}

      {!!lowStock && (
        <Link to="/stock" className="list-row alert-row">
          <PackageOpen size={22} aria-hidden />
          <span className="list-main">
            <span className="list-title">{t('stock.lowCard', { n: lowStock })}</span>
          </span>
          <ChevronRight size={22} aria-hidden />
        </Link>
      )}

      <section className="actions">
        <button type="button" className="action action-primary" onClick={() => setAdding('sale')}>
          <ShoppingBag size={28} aria-hidden />
          {t('home.sale')}
        </button>
        <button type="button" className="action" onClick={() => setAdding('expense')}>
          <Receipt size={28} aria-hidden />
          {t('home.expense')}
        </button>
        <button type="button" className="action" onClick={() => setAdding('credit')}>
          <HandCoins size={28} aria-hidden />
          {t('home.credit')}
        </button>
      </section>

      {live.length > 0 && (
        <div className="list recent">
          {live.slice(0, RECENT).map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              customerName={e.customerId ? customers.get(e.customerId)?.name : undefined}
              onOpen={() => setOpenId(e.id)}
            />
          ))}
        </div>
      )}

      {adding && <EntryForm kind={adding} onClose={() => setAdding(null)} />}
      {openId && <EntryDetail entryId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
