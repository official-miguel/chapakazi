import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCheck, PackageMinus, PackagePlus, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { db } from '../db'
import type { WordKey } from '../i18n'
import { useI18n } from '../i18n'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { archiveItem, changeStock, parseQty, stockState } from '../stock'
import { formatQty, unitName } from '../units'
import { useTimeFormat } from '../useTimeFormat'
import { ItemForm } from './ItemForm'
import { Sheet } from './Sheet'

type Mode = 'view' | 'edit' | 'restock' | 'count' | 'damage' | 'remove'

const RECENT_MOVES = 6

/** One item in full: how much is left, its prices, and buttons to restock or correct the count. */
export function ItemDetail({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { t } = useI18n()
  const { dir, person, isAdmin } = useSession()
  const { dateTime } = useTimeFormat()
  const [mode, setMode] = useState<Mode>('view')
  const [amount, setAmount] = useState('')
  const [bad, setBad] = useState(false)

  const found = useLiveQuery(async () => {
    const item = await db.items.get(itemId)
    // The buying price is only ever read for the owner.
    const cost = isAdmin ? await db.itemCosts.get(itemId) : undefined
    const moves = (await db.stockMoves.where('itemId').equals(itemId).toArray())
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT_MOVES)
    return { item, cost, moves }
  }, [itemId, isAdmin])

  if (!found?.item || !person) return null
  const { item, cost, moves } = found
  const unit = unitName(t, item.unit)
  const state = stockState(item)

  const back = () => {
    setMode('view')
    setAmount('')
    setBad(false)
  }

  if (mode === 'edit') {
    return <ItemForm editing={item} editingCostCents={cost?.costCents} onClose={back} />
  }

  if (mode === 'remove') {
    return (
      <Sheet title={`${t('stock.remove')}?`} onClose={back}>
        <p className="sheet-text">{t('stock.removeText')}</p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            await archiveItem(item.id)
            onClose()
          }}
        >
          {t('stock.remove')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={back}>
          {t('common.cancel')}
        </button>
      </Sheet>
    )
  }

  if (mode === 'restock' || mode === 'count' || mode === 'damage') {
    const titles: Record<typeof mode, WordKey> = { restock: 'stock.restock', count: 'stock.count', damage: 'stock.damage' }
    const apply = async (e: FormEvent) => {
      e.preventDefault()
      const qty = parseQty(amount)
      // A count may be zero ("none left"); adding or removing zero makes no sense.
      if (qty === null || (mode !== 'count' && qty === 0)) {
        setBad(true)
        return
      }
      await changeStock(item.id, mode, qty, person.id)
      back()
    }
    return (
      <Sheet title={`${t(titles[mode])} · ${item.name}`} onClose={back}>
        <form onSubmit={apply}>
          <label className="field">
            <span>{t(mode === 'count' ? 'stock.countNow' : 'stock.howMany', { unit })}</span>
            <input
              className="amount-input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setBad(false)
              }}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              autoFocus
              aria-invalid={bad}
            />
          </label>
          {bad && (
            <p className="field-error" role="alert">
              {t('stock.formBad')}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            {t('common.save')}
          </button>
        </form>
      </Sheet>
    )
  }

  const profitCents = cost && item.priceCents !== undefined ? item.priceCents - cost.costCents : undefined

  return (
    <Sheet title={item.name} onClose={onClose}>
      {item.tracked ? (
        <p className={`detail-amount ${state === 'out' ? 'money-out' : state === 'low' ? 'ink-amber' : ''}`}>
          {formatQty(item.qty)} <span className="detail-unit">{unit}</span>
        </p>
      ) : (
        <p className="detail-line">{t('stock.notCounted')}</p>
      )}
      {item.priceCents !== undefined && (
        <p className="detail-line">{t('stock.priceEach', { amount: formatKsh(item.priceCents), unit })}</p>
      )}

      {isAdmin &&
        (cost ? (
          <p className="detail-meta">
            {t('stock.buyingPrice', { amount: formatKsh(cost.costCents) })}
            {profitCents !== undefined && ` · ${t('stock.profitPer', { amount: formatKsh(profitCents), unit })}`}
          </p>
        ) : (
          <p className="detail-meta">{t('stock.noCost')}</p>
        ))}

      {item.tracked && (
        <>
          <button type="button" className="btn btn-primary" onClick={() => setMode('restock')}>
            <PackagePlus size={22} aria-hidden /> {t('stock.restock')}
          </button>
          <div className="btn-pair">
            <button type="button" className="btn btn-quiet" onClick={() => setMode('count')}>
              <ClipboardCheck size={20} aria-hidden /> {t('stock.count')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('damage')}>
              <PackageMinus size={20} aria-hidden /> {t('stock.damage')}
            </button>
          </div>
        </>
      )}
      <button type="button" className="btn btn-quiet" onClick={() => setMode('edit')}>
        <Pencil size={20} aria-hidden /> {t('stock.edit')}
      </button>

      {moves.length > 0 && (
        <section className="history">
          <h3>{t('stock.recent')}</h3>
          <ol>
            {moves.map((m) => (
              <li key={m.id} className="move">
                <span>
                  <span className="history-who">{t(`move.${m.reason}`)}</span>
                  <span className="history-when">
                    {dir.people.find((p) => p.id === m.byPersonId)?.name ?? '?'} · {dateTime(m.at)}
                  </span>
                </span>
                <span className={m.qty > 0 ? 'row-amount money-in' : 'row-amount money-out'}>
                  {m.qty > 0 ? '+' : '−'} {formatQty(Math.abs(m.qty))}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {isAdmin && (
        <button type="button" className="link-danger remove-link" onClick={() => setMode('remove')}>
          {t('stock.remove')}
        </button>
      )}
    </Sheet>
  )
}
