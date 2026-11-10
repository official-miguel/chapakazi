import { useLiveQuery } from 'dexie-react-hooks'
import { Package, Plus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { ItemDetail } from '../components/ItemDetail'
import { ItemForm } from '../components/ItemForm'
import { db } from '../db'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { stockState } from '../stock'
import type { StockState } from '../stock'
import { formatQty, unitName } from '../units'

// Items that need attention come first.
const order: Record<StockState, number> = { out: 0, low: 1, ok: 2, untracked: 3 }

/** Everything the shop sells and how much is left. */
export function StockScreen() {
  const { t } = useI18n()
  const { dir, shops } = useSession()
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const shopIds = shops.map((s) => s.id)
  const items = useLiveQuery(
    async () =>
      (await db.items.where('businessId').anyOf(shopIds).toArray())
        .filter((i) => !i.archived)
        .sort((a, b) => order[stockState(a)] - order[stockState(b)] || a.name.localeCompare(b.name)),
    [shopIds.join()],
  )

  return (
    <>
      <h1 className="screen-title">{t('nav.stock')}</h1>

      {items &&
        (items.length === 0 ? (
          <EmptyState icon={<Package size={40} />} title={t('stock.empty')} hint={t('stock.emptyHint')} />
        ) : (
          <div className="list list-gap">
            {items.map((item) => {
              const state = stockState(item)
              const unit = unitName(t, item.unit)
              const shop = shops.length > 1 ? dir.businesses.find((b) => b.id === item.businessId)?.name : undefined
              const sub = [
                item.priceCents !== undefined ? t('stock.priceEach', { amount: formatKsh(item.priceCents), unit }) : null,
                shop,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <button key={item.id} type="button" className="list-row" onClick={() => setOpenId(item.id)}>
                  <span className="list-main">
                    <span className="list-title">{item.name}</span>
                    {sub && <span className="list-sub">{sub}</span>}
                  </span>
                  <span className="row-end">
                    {item.tracked ? (
                      <span className={`row-amount ${state === 'out' ? 'money-out' : state === 'low' ? 'ink-amber' : ''}`}>
                        {formatQty(item.qty)} {unit}
                      </span>
                    ) : (
                      <span className="list-sub">{t('stock.notCounted')}</span>
                    )}
                    {state === 'out' && <span className="tag tag-red">{t('stock.out')}</span>}
                    {state === 'low' && <span className="tag tag-amber">{t('stock.low')}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        ))}

      <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
        <Plus size={22} aria-hidden /> {t('stock.add')}
      </button>

      {adding && <ItemForm onClose={() => setAdding(false)} />}
      {openId && <ItemDetail itemId={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}
