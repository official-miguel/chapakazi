import { useLiveQuery } from 'dexie-react-hooks'
import { MessageCircle, MessageSquare, Pencil, Plus, Truck } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { EmptyState } from '../components/EmptyState'
import { Sheet } from '../components/Sheet'
import { smsLink, whatsappLink } from '../customers'
import { db } from '../db'
import type { Supplier, SupplierMove } from '../db'
import { useI18n } from '../i18n'
import { parseAmount } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { parseQty } from '../stock'
import { addSupplier, addSupplierMove, owedBySupplier, restockSuggestions, undoSupplierMove, updateSupplier } from '../suppliers'
import type { Suggestion } from '../suppliers'
import { formatQty, unitName } from '../units'
import { useTimeFormat } from '../useTimeFormat'

const NO_SUPPLIER = ''

/** Owner only: suppliers, what is owed to them, and what to order next. */
export function SuppliersScreen() {
  const { t } = useI18n()
  const { dir, person, shops, ownsShop } = useSession()
  const { dateTime } = useTimeFormat()
  const shopIds = shops.map((s) => s.id)

  const data = useLiveQuery(async () => {
    const suppliers = (await db.suppliers.where('businessId').anyOf(shopIds).toArray()).sort((a, b) => a.name.localeCompare(b.name))
    const moves = (await db.supplierMoves.where('businessId').anyOf(shopIds).toArray()).sort((a, b) => b.at - a.at)
    return { suppliers, moves, suggestions: await restockSuggestions(shopIds, Date.now()) }
  }, [shopIds.join()])

  // Sheets: add/edit a supplier, one supplier's page, a money record, and an order draft.
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [moveKind, setMoveKind] = useState<SupplierMove['kind'] | null>(null)
  const [orderFor, setOrderFor] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [alsoExpense, setAlsoExpense] = useState(true)
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)
  // The owner's own order amounts, where they differ from the suggestion. Empty text leaves an item out.
  const [orderQty, setOrderQty] = useState<Record<string, string>>({})

  if (!person || !data) return null
  const { suppliers, moves, suggestions } = data
  const owed = owedBySupplier(moves)
  const totalOwed = [...owed.values()].reduce((sum, v) => sum + Math.max(0, v), 0)
  const open = suppliers.find((s) => s.id === openId) ?? null

  const startEdit = (supplier: Supplier | 'new') => {
    setEditing(supplier)
    setName(supplier === 'new' ? '' : supplier.name)
    setPhone(supplier === 'new' ? '' : (supplier.phone ?? ''))
    setBad(false)
  }

  const saveSupplier = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !editing) {
      setBad(true)
      return
    }
    if (editing === 'new') await addSupplier(shopId, { name, phone })
    else await updateSupplier(editing.id, { name, phone })
    setEditing(null)
  }

  const startMove = (kind: SupplierMove['kind']) => {
    setMoveKind(kind)
    setAmount('')
    setNote('')
    setMethod('cash')
    setAlsoExpense(true)
    setBad(false)
  }

  const saveMove = async (e: FormEvent) => {
    e.preventDefault()
    const amountCents = parseAmount(amount)
    if (!open || !moveKind || amountCents === null) {
      setBad(true)
      return
    }
    await addSupplierMove(
      open,
      { kind: moveKind, amountCents, method, note },
      { personId: person.id, isOwner: ownsShop(open.businessId) },
      alsoExpense,
    )
    setMoveKind(null)
  }

  // ---- orders: suggestions grouped by supplier

  const groups = new Map<string, Suggestion[]>()
  for (const s of suggestions) {
    const key = s.item.supplierId && suppliers.some((x) => x.id === s.item.supplierId) ? s.item.supplierId : NO_SUPPLIER
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const qtyText = (s: Suggestion) => orderQty[s.item.id] ?? (s.orderQty === null ? '' : String(s.orderQty))

  const orderSupplier = suppliers.find((s) => s.id === orderFor) ?? null
  const orderLines = (groups.get(orderFor ?? NO_SUPPLIER) ?? [])
    .map((s) => ({ s, qty: parseQty(qtyText(s)) }))
    .filter((x): x is { s: Suggestion; qty: number } => x.qty !== null && x.qty > 0)
  const orderShop = dir.businesses.find((b) => b.id === orderSupplier?.businessId)?.name ?? ''
  const orderMessage = orderSupplier
    ? [
        t('sup.orderHello', { name: orderSupplier.name, shop: orderShop }),
        ...orderLines.map((x) => `- ${x.s.item.name}: ${formatQty(x.qty)} ${unitName(t, x.s.item.unit)}`),
        t('sup.orderThanks'),
      ].join('\n')
    : ''

  return (
    <>
      <h1 className="screen-title">{t('sup.title')}</h1>

      <div className="total-card owed-card">
        <span className="total-label">{t('sup.youOwe')}</span>
        <span className={`total-value ${totalOwed > 0 ? 'ink-amber' : ''}`}>{formatKsh(totalOwed)}</span>
      </div>

      <section className="card">
        <h2 className="card-title">{t('sup.toOrder')}</h2>
        {suggestions.length === 0 ? (
          <p className="summary-text">{t('sup.nothingToOrder')}</p>
        ) : (
          [...groups.entries()].map(([supplierId, list]) => {
            const supplier = suppliers.find((s) => s.id === supplierId)
            return (
              <div key={supplierId || 'none'} className="order-group">
                <h3>{supplier?.name ?? t('sup.noSupplier')}</h3>
                {list.map((s) => (
                  <label key={s.item.id} className="order-row">
                    <span className="list-main">
                      <span className="list-title">{s.item.name}</span>
                      <span className="list-sub">
                        {t('stock.left', { qty: formatQty(s.item.qty), unit: unitName(t, s.item.unit) })}
                        {s.daysLeft !== null && ` · ${t('sup.daysLeft', { n: Math.max(0, Math.floor(s.daysLeft)) })}`}
                      </span>
                    </span>
                    <input
                      className="order-qty"
                      value={qtyText(s)}
                      onChange={(e) => setOrderQty({ ...orderQty, [s.item.id]: e.target.value })}
                      inputMode="decimal"
                      aria-label={`${t('sup.orderAmount')} ${s.item.name}`}
                      placeholder="0"
                    />
                    <span className="order-unit">{unitName(t, s.item.unit)}</span>
                  </label>
                ))}
                {supplier ? (
                  <button type="button" className="btn btn-quiet" onClick={() => setOrderFor(supplier.id)}>
                    {t('sup.draft')}
                  </button>
                ) : (
                  <p className="card-note">{t('sup.noSupplierHint')}</p>
                )}
              </div>
            )
          })
        )}
      </section>

      {suppliers.length === 0 ? (
        <EmptyState icon={<Truck size={40} />} title={t('sup.empty')} hint={t('sup.emptyHint')} />
      ) : (
        <div className="list list-gap card-gap">
          {suppliers.map((s) => {
            const owes = owed.get(s.id) ?? 0
            return (
              <button key={s.id} type="button" className="list-row" onClick={() => setOpenId(s.id)}>
                <span className="avatar" aria-hidden>
                  {s.name.charAt(0).toUpperCase()}
                </span>
                <span className="list-main">
                  <span className="list-title">{s.name}</span>
                  <span className="list-sub">
                    {[s.phone, shops.length > 1 ? dir.businesses.find((b) => b.id === s.businessId)?.name : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`row-amount ${owes > 0 ? 'ink-amber' : 'ink-dim'}`}>
                  {owes > 0 ? formatKsh(owes) : t('sup.nothingOwed')}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <button type="button" className="btn btn-primary" onClick={() => startEdit('new')}>
        <Plus size={22} aria-hidden /> {t('sup.add')}
      </button>

      {open && !moveKind && !editing && (
        <Sheet title={open.name} onClose={() => setOpenId(null)}>
          <p className={`detail-amount ${(owed.get(open.id) ?? 0) > 0 ? 'ink-amber' : ''}`}>{formatKsh(Math.max(0, owed.get(open.id) ?? 0))}</p>
          <p className="detail-meta">{[t('sup.youOwe'), open.phone].filter(Boolean).join(' · ')}</p>
          <button type="button" className="btn btn-primary" onClick={() => startMove('payment')}>
            {t('sup.pay')}
          </button>
          <div className="btn-pair">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => startMove('purchase')}>
              {t('sup.buyOnCredit')}
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => startEdit(open)}>
              <Pencil size={18} aria-hidden /> {t('sup.edit')}
            </button>
          </div>
          {moves.some((m) => m.supplierId === open.id) && (
            <section className="history">
              <h3>{t('sup.records')}</h3>
              <ol>
                {moves
                  .filter((m) => m.supplierId === open.id)
                  .map((m) => (
                    <li key={m.id} className="move">
                      <span>
                        <span className={m.undoneAt ? 'history-who struck' : 'history-who'}>
                          {t(m.kind === 'purchase' ? 'sup.buyOnCredit' : 'sup.paid')} · {formatKsh(m.amountCents)}
                        </span>
                        <span className="history-when">
                          {[dateTime(m.at), m.method ? t(m.method === 'cash' ? 'entry.cash' : 'entry.mpesa') : null, m.note].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {!m.undoneAt && (
                        <button type="button" className="link-danger" onClick={() => void undoSupplierMove(m.id)}>
                          {t('sup.undo')}
                        </button>
                      )}
                    </li>
                  ))}
              </ol>
            </section>
          )}
        </Sheet>
      )}

      {open && moveKind && (
        <Sheet title={`${t(moveKind === 'purchase' ? 'sup.buyOnCredit' : 'sup.pay')} · ${open.name}`} onClose={() => setMoveKind(null)}>
          <form onSubmit={saveMove} onChange={() => setBad(false)}>
            <label className="field">
              <span>{t('entry.amount')}</span>
              <input className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0" autoFocus />
            </label>
            {moveKind === 'payment' && (
              <>
                <div className="field">
                  <span>{t('entry.paidBy')}</span>
                  <div className="segmented">
                    {(['cash', 'mpesa'] as const).map((m) => (
                      <button key={m} type="button" className={m === method ? 'segment segment-on' : 'segment'} aria-pressed={m === method} onClick={() => setMethod(m)}>
                        {t(m === 'cash' ? 'entry.cash' : 'entry.mpesa')}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="check">
                  <input type="checkbox" checked={alsoExpense} onChange={(e) => setAlsoExpense(e.target.checked)} />
                  <span>
                    {t('sup.alsoExpense')}
                    <small>{t('sup.alsoExpenseHint')}</small>
                  </span>
                </label>
              </>
            )}
            <label className="field">
              <span>{t('entry.note')}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" />
            </label>
            {bad && (
              <p className="field-error" role="alert">
                {t('entry.amountBad')}
              </p>
            )}
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </form>
        </Sheet>
      )}

      {editing && (
        <Sheet title={editing === 'new' ? t('sup.add') : t('sup.edit')} onClose={() => setEditing(null)}>
          <form onSubmit={saveSupplier} onChange={() => setBad(false)}>
            <label className="field">
              <span>{t('sup.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
            </label>
            <label className="field">
              <span>{t('onboard.phone')}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="07…" />
            </label>
            {editing === 'new' && shops.length > 1 && (
              <div className="field">
                <span>{t('entry.shop')}</span>
                <div className="chips">
                  {shops.map((s) => (
                    <button key={s.id} type="button" className={s.id === shopId ? 'chip chip-on' : 'chip'} aria-pressed={s.id === shopId} onClick={() => setShopId(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
      )}

      {orderSupplier && (
        <Sheet title={`${t('sup.draft')} · ${orderSupplier.name}`} onClose={() => setOrderFor(null)}>
          {orderLines.length === 0 ? (
            <p className="sheet-text">{t('sup.orderEmpty')}</p>
          ) : (
            <>
              <pre className="order-text">{orderMessage}</pre>
              {orderSupplier.phone && whatsappLink(orderSupplier.phone, orderMessage) ? (
                <div className="btn-pair">
                  <a className="btn btn-primary btn-small" href={whatsappLink(orderSupplier.phone, orderMessage) ?? '#'} target="_blank" rel="noreferrer">
                    <MessageCircle size={20} aria-hidden /> WhatsApp
                  </a>
                  <a className="btn btn-quiet btn-small" href={smsLink(orderSupplier.phone, orderMessage) ?? '#'}>
                    <MessageSquare size={20} aria-hidden /> SMS
                  </a>
                </div>
              ) : (
                <p className="hint-note">{t('sup.orderNoPhone')}</p>
              )}
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
