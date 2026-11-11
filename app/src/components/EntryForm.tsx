import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { db, newId } from '../db'
import type { Customer, Entry, EntryKind, EntryLine, ExpenseCategory, Item, PayMethod } from '../db'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { editEntry, parseAmount, recordEntry } from '../ledger'
import { formatKsh } from '../money'
import { useSession } from '../session'
import { parseQty, round3 } from '../stock'
import { useToast } from '../toast'
import { formatQty, unitName } from '../units'
import { CustomerPicker } from './CustomerPicker'
import { Sheet } from './Sheet'

export const categories: { id: ExpenseCategory; label: WordKey }[] = [
  { id: 'stock', label: 'cat.stock' },
  { id: 'rent', label: 'cat.rent' },
  { id: 'transport', label: 'cat.transport' },
  { id: 'electricity', label: 'cat.electricity' },
  { id: 'water', label: 'cat.water' },
  { id: 'wages', label: 'cat.wages' },
  { id: 'other', label: 'cat.other' },
]

export const categoryLabel = (id: ExpenseCategory | undefined): WordKey =>
  categories.find((c) => c.id === id)?.label ?? 'cat.other'

const methods: { id: PayMethod; label: WordKey }[] = [
  { id: 'cash', label: 'entry.cash' },
  { id: 'mpesa', label: 'entry.mpesa' },
]

const newTitle: Record<EntryKind, WordKey> = {
  sale: 'entry.newSale',
  expense: 'entry.newExpense',
  credit: 'entry.newCredit',
  payment: 'entry.newPayment',
}

/** An item in the sale while it is being typed. Quantity and total are kept as text until saved. */
type LineDraft = {
  id: string
  itemId: string
  name: string
  unit: string
  priceCents?: number
  qty: string
  total: string
}

const centsText = (cents: number) => String(cents / 100)
const totalFor = (priceCents: number | undefined, qty: number) =>
  priceCents === undefined ? '' : centsText(Math.round(priceCents * qty))

const toDraft = (line: EntryLine): LineDraft => ({
  id: line.id,
  itemId: line.itemId,
  name: line.name,
  unit: line.unit,
  priceCents: line.unitPriceCents,
  qty: String(line.qty),
  total: line.totalCents ? centsText(line.totalCents) : '',
})

export type EntryDraft = {
  shopId?: string
  amountCents?: number | null
  method?: PayMethod
  category?: ExpenseCategory
  note?: string
  lines?: EntryLine[]
  customer?: Customer
}

/** The form for a new sale, expense, credit or debt payment, and for editing an existing entry. */
export function EntryForm({
  kind,
  editing,
  forCustomer,
  draft,
  onClose,
}: {
  kind: EntryKind
  /** When given, the form changes this entry instead of adding a new one. */
  editing?: Entry
  /** When opened from a customer's page, the credit or payment is for them. */
  forCustomer?: Customer
  /** Values to start a new entry with, for example what was understood from voice. */
  draft?: EntryDraft
  onClose: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const { person, shops, ownsShop } = useSession()
  const takesItems = kind === 'sale' || kind === 'credit'
  const needsCustomer = kind === 'credit' || kind === 'payment'
  const [amount, setAmount] = useState(editing ? centsText(editing.amountCents) : draft?.amountCents ? centsText(draft.amountCents) : '')
  const [method, setMethod] = useState<PayMethod>(() => {
    const start = editing?.method ?? draft?.method
    return start && start !== 'credit' ? start : 'cash'
  })
  const [category, setCategory] = useState<ExpenseCategory>(editing?.category ?? draft?.category ?? 'stock')
  const [note, setNote] = useState(editing?.note ?? draft?.note ?? '')
  const [shopId, setShopId] = useState(editing?.businessId ?? forCustomer?.businessId ?? draft?.shopId ?? shops[0]?.id ?? '')
  const [picked, setPicked] = useState<Customer | null>(forCustomer ?? draft?.customer ?? null)
  // When editing, the customer is fixed; they are looked up only to show their name.
  const editedCustomer = useLiveQuery(
    async () => (editing?.customerId ? ((await db.customers.get(editing.customerId)) ?? null) : null),
    [editing?.customerId],
  )
  const customer = editing ? (editedCustomer ?? null) : picked
  const [lines, setLines] = useState<LineDraft[]>(() => (editing?.lines ?? draft?.lines ?? []).map(toDraft))
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<WordKey | null>(null)
  const [saving, setSaving] = useState(false)

  const items = useLiveQuery(
    async () =>
      takesItems && shopId
        ? (await db.items.where('businessId').equals(shopId).toArray())
            .filter((i) => !i.archived)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [takesItems, shopId],
  )

  if (!person) return null

  const title = editing ? t('entry.edit') : t(newTitle[kind])

  // Going over the limit only warns. The credit can still be saved.
  const typedCents = parseAmount(amount) ?? 0
  const owedAfter = (customer?.balanceCents ?? 0) + typedCents
  const overLimit =
    kind === 'credit' && !editing && customer?.limitCents !== undefined && typedCents > 0 && owedAfter > customer.limitCents

  /** Whenever the items change, the amount follows their total. It can still be typed over (a discount, say). */
  const applyLines = (next: LineDraft[]) => {
    setLines(next)
    setError(null)
    const sum = next.reduce((acc, l) => acc + (parseAmount(l.total) ?? 0), 0)
    if (sum > 0) setAmount(centsText(sum))
  }

  const addItem = (item: Item) => {
    const existing = lines.find((l) => l.itemId === item.id)
    if (existing) {
      const qty = round3((parseQty(existing.qty) ?? 0) + 1)
      applyLines(lines.map((l) => (l === existing ? { ...l, qty: String(qty), total: totalFor(l.priceCents, qty) } : l)))
    } else {
      applyLines([
        ...lines,
        { id: newId(), itemId: item.id, name: item.name, unit: item.unit, priceCents: item.priceCents, qty: '1', total: totalFor(item.priceCents, 1) },
      ])
    }
  }

  // Typing a quantity works out the money; typing the money works out the quantity
  // ("sugar for 50 bob"), as long as the item has a price.
  const changeQty = (id: string, text: string) => {
    const qty = parseQty(text)
    applyLines(lines.map((l) => (l.id === id ? { ...l, qty: text, total: qty !== null && l.priceCents !== undefined ? totalFor(l.priceCents, qty) : l.total } : l)))
  }

  const changeTotal = (id: string, text: string) => {
    const cents = parseAmount(text)
    applyLines(
      lines.map((l) =>
        l.id === id ? { ...l, total: text, qty: cents !== null && l.priceCents ? String(round3(cents / l.priceCents)) : l.qty } : l,
      ),
    )
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const amountCents = parseAmount(amount)
    if (needsCustomer && !customer) {
      setError('entry.customerNeeded')
      return
    }
    if (amountCents === null || !shopId) {
      setError('entry.amountBad')
      return
    }
    const finalLines: EntryLine[] = []
    for (const l of lines) {
      const qty = parseQty(l.qty)
      if (qty === null || qty === 0) {
        setError('entry.qtyBad')
        return
      }
      finalLines.push({
        id: l.id,
        itemId: l.itemId,
        name: l.name,
        unit: l.unit,
        qty,
        unitPriceCents: l.priceCents,
        totalCents: parseAmount(l.total) ?? 0,
      })
    }
    if (saving) return
    setSaving(true)
    try {
      const data = {
        kind,
        amountCents,
        method,
        category: kind === 'expense' ? category : undefined,
        note,
        lines: takesItems ? finalLines : undefined,
      }
      const actor = { personId: person.id, isOwner: ownsShop(shopId) }
      if (editing) await editEntry(editing.id, data, actor)
      else await recordEntry(shopId, data, actor, customer?.id)
      toast(t('entry.saved'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const wanted = search.trim().toLowerCase()
  const shown = (items ?? []).filter((i) => !wanted || i.name.toLowerCase().includes(wanted))

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={save}>
        {!editing && !forCustomer && shops.length > 1 && (
          <div className="field">
            <span>{t('entry.shop')}</span>
            <div className="chips">
              {shops.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === shopId ? 'chip chip-on' : 'chip'}
                  aria-pressed={s.id === shopId}
                  onClick={() => {
                    // Items belong to one shop, so a sale started for another shop starts over.
                    if (s.id !== shopId) {
                      setLines([])
                      setPicked(null)
                    }
                    setShopId(s.id)
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {needsCustomer && shopId && (
          <CustomerPicker
            shopId={shopId}
            value={customer}
            locked={!!editing || !!forCustomer}
            onChange={(c) => {
              setPicked(c)
              setError(null)
            }}
          />
        )}

        {takesItems && (
          <div className="field">
            {lines.map((l) => (
              <div key={l.id} className="line">
                <div className="line-head">
                  <span className="line-name">{l.name}</span>
                  <button type="button" className="icon-btn" aria-label={`${t('entry.removeLine')} ${l.name}`} onClick={() => applyLines(lines.filter((x) => x.id !== l.id))}>
                    <X size={20} aria-hidden />
                  </button>
                </div>
                <div className="line-inputs">
                  <label>
                    <span>
                      {t('entry.qty')} ({unitName(t, l.unit)})
                    </span>
                    <input value={l.qty} onChange={(e) => changeQty(l.id, e.target.value)} inputMode="decimal" autoComplete="off" />
                  </label>
                  <label>
                    <span>{t('entry.lineTotal')}</span>
                    <input value={l.total} onChange={(e) => changeTotal(l.id, e.target.value)} inputMode="decimal" autoComplete="off" />
                  </label>
                </div>
              </div>
            ))}

            <button type="button" className="btn btn-quiet picker-toggle" aria-expanded={picking} onClick={() => setPicking(!picking)}>
              {picking ? <ChevronUp size={20} aria-hidden /> : <ChevronDown size={20} aria-hidden />}
              {t(picking ? 'entry.hideItems' : 'entry.addItems')}
            </button>

            {picking &&
              (items && items.length === 0 ? (
                <p className="picker-empty">{t('entry.noItems')}</p>
              ) : (
                <div className="picker">
                  {(items?.length ?? 0) > 6 && (
                    <input
                      className="picker-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('entry.search')}
                      aria-label={t('entry.search')}
                    />
                  )}
                  {shown.map((item) => (
                    <button key={item.id} type="button" className="picker-row" onClick={() => addItem(item)}>
                      <span className="list-main">
                        <span className="picker-name">{item.name}</span>
                        <span className="list-sub">
                          {[
                            item.priceCents !== undefined ? formatKsh(item.priceCents) : null,
                            item.tracked ? t('stock.left', { qty: formatQty(item.qty), unit: unitName(t, item.unit) }) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="picker-plus" aria-hidden>
                        +
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
        )}

        <label className="field">
          <span>{t('entry.amount')}</span>
          <input
            className="amount-input"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            autoFocus={!editing?.lines?.length && !(needsCustomer && !customer)}
            aria-invalid={error === 'entry.amountBad'}
          />
        </label>

        {overLimit && customer?.limitCents !== undefined && (
          <p className="warn-note" role="status">
            {t('debts.overLimit', {
              name: customer.name,
              total: formatKsh(owedAfter),
              limit: formatKsh(customer.limitCents),
            })}
          </p>
        )}

        {/* Credit has no "paid by": no money has changed hands yet. */}
        {kind !== 'credit' && (
          <div className="field">
            <span>{t('entry.paidBy')}</span>
            <div className="segmented">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === method ? 'segment segment-on' : 'segment'}
                  aria-pressed={m.id === method}
                  onClick={() => setMethod(m.id)}
                >
                  {t(m.label)}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === 'expense' && (
          <div className="field">
            <span>{t('entry.whatFor')}</span>
            <div className="chips">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={c.id === category ? 'chip chip-on' : 'chip'}
                  aria-pressed={c.id === category}
                  onClick={() => setCategory(c.id)}
                >
                  {t(c.label)}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          <span>{t('entry.note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" />
        </label>

        {error && (
          <p className="field-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
