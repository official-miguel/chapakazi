import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { db } from '../db'
import type { Item } from '../db'
import { useI18n } from '../i18n'
import { parseAmount } from '../ledger'
import { useSession } from '../session'
import { addItem, parseQty, updateItem } from '../stock'
import { useToast } from '../toast'
import { units } from '../units'
import { Sheet } from './Sheet'

const OWN_UNIT = '__own__'

/** Add a new item, or change an existing one. The buying price field is shown to the owner only. */
export function ItemForm({
  editing,
  editingCostCents,
  onClose,
}: {
  editing?: Item
  /** The current buying price, passed in by the owner's screen when editing. */
  editingCostCents?: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const { person, shops, isAdmin } = useSession()

  const startsWithOwnUnit = editing !== undefined && !units.some((u) => u.id === editing.unit)
  const [name, setName] = useState(editing?.name ?? '')
  const [unit, setUnit] = useState(startsWithOwnUnit ? OWN_UNIT : (editing?.unit ?? 'pcs'))
  const [ownUnit, setOwnUnit] = useState(startsWithOwnUnit ? editing.unit : '')
  const [price, setPrice] = useState(editing?.priceCents !== undefined ? String(editing.priceCents / 100) : '')
  const [cost, setCost] = useState(editingCostCents !== undefined ? String(editingCostCents / 100) : '')
  const [tracked, setTracked] = useState(editing?.tracked ?? true)
  const [opening, setOpening] = useState('')
  const [lowAt, setLowAt] = useState(editing?.lowAt !== undefined ? String(editing.lowAt) : '')
  const [shopId, setShopId] = useState(editing?.businessId ?? shops[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState(editing?.supplierId ?? '')
  const [showError, setShowError] = useState(false)
  // Suppliers are the owner's business, so only the owner's form offers them.
  const suppliers = useLiveQuery(
    async () => (isAdmin && shopId ? await db.suppliers.where('businessId').equals(shopId).sortBy('name') : []),
    [isAdmin, shopId],
  )
  const [saving, setSaving] = useState(false)

  if (!person) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    // An empty optional box means "not set"; anything typed must be a valid number.
    const optional = <T,>(text: string, parse: (s: string) => T | null): T | undefined | null =>
      text.trim() === '' ? undefined : parse(text)

    const finalUnit = unit === OWN_UNIT ? ownUnit.trim() : unit
    const priceCents = optional(price, parseAmount)
    const costCents = optional(cost, parseAmount)
    const lowLevel = optional(lowAt, parseQty)
    const openingQty = optional(opening, parseQty)

    if (!name.trim() || !finalUnit || !shopId || [priceCents, costCents, lowLevel, openingQty].includes(null)) {
      setShowError(true)
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const input = {
        name,
        unit: finalUnit,
        priceCents: priceCents ?? undefined,
        lowAt: tracked ? (lowLevel ?? undefined) : undefined,
        tracked,
        // A worker's save keeps whatever supplier the owner chose.
        supplierId: isAdmin ? supplierId || undefined : editing?.supplierId,
      }
      if (editing) {
        // Only the owner's form may touch the buying price; a worker's save leaves it as it was.
        await updateItem(editing.id, input, isAdmin ? (costCents ?? null) : undefined)
      } else {
        await addItem(shopId, input, openingQty ?? 0, isAdmin ? (costCents ?? undefined) : undefined, person.id)
      }
      toast(t('entry.saved'))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const clearError = () => setShowError(false)

  return (
    <Sheet title={editing ? t('stock.edit') : t('stock.add')} onClose={onClose}>
      <form onSubmit={save} onChange={clearError}>
        <label className="field">
          <span>{t('stock.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
        </label>

        <div className="field">
          <span>{t('stock.unit')}</span>
          <div className="chips">
            {units.map((u) => (
              <button
                key={u.id}
                type="button"
                className={u.id === unit ? 'chip chip-on' : 'chip'}
                aria-pressed={u.id === unit}
                onClick={() => setUnit(u.id)}
              >
                {t(u.label)}
              </button>
            ))}
            <button
              type="button"
              className={unit === OWN_UNIT ? 'chip chip-on' : 'chip'}
              aria-pressed={unit === OWN_UNIT}
              onClick={() => setUnit(OWN_UNIT)}
            >
              {t('stock.unitOther')}
            </button>
          </div>
        </div>
        {unit === OWN_UNIT && (
          <label className="field">
            <span>{t('stock.unitOwn')}</span>
            <input value={ownUnit} onChange={(e) => setOwnUnit(e.target.value)} maxLength={20} autoComplete="off" />
          </label>
        )}

        <label className="field">
          <span>{t('stock.price')}</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoComplete="off" />
        </label>

        {isAdmin && (
          <label className="field">
            <span>{t('stock.cost')}</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" autoComplete="off" />
            <small>{t('stock.costHint')}</small>
          </label>
        )}

        {isAdmin && suppliers && suppliers.length > 0 && (
          <div className="field">
            <span>{t('sup.boughtFrom')}</span>
            <div className="chips">
              <button type="button" className={supplierId === '' ? 'chip chip-on' : 'chip'} aria-pressed={supplierId === ''} onClick={() => setSupplierId('')}>
                {t('sup.none')}
              </button>
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === supplierId ? 'chip chip-on' : 'chip'}
                  aria-pressed={s.id === supplierId}
                  onClick={() => setSupplierId(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={tracked} onChange={(e) => setTracked(e.target.checked)} />
          <span>
            {t('stock.track')}
            <small>{t('stock.trackHint')}</small>
          </span>
        </label>

        {tracked && !editing && (
          <label className="field">
            <span>{t('stock.opening')}</span>
            <input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0" />
          </label>
        )}
        {tracked && (
          <label className="field">
            <span>{t('stock.lowAt')}</span>
            <input value={lowAt} onChange={(e) => setLowAt(e.target.value)} inputMode="decimal" autoComplete="off" />
          </label>
        )}

        {!editing && shops.length > 1 && (
          <div className="field">
            <span>{t('entry.shop')}</span>
            <div className="chips">
              {shops.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === shopId ? 'chip chip-on' : 'chip'}
                  aria-pressed={s.id === shopId}
                  onClick={() => setShopId(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {showError && (
          <p className="field-error" role="alert">
            {t('stock.formBad')}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
