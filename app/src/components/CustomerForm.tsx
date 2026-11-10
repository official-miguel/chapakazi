import { useState } from 'react'
import type { FormEvent } from 'react'
import { addCustomer, updateCustomer } from '../customers'
import type { Customer } from '../db'
import { useI18n } from '../i18n'
import { parseAmount } from '../ledger'
import { useSession } from '../session'
import { Sheet } from './Sheet'

/** Add a customer, or change their name, phone and credit limit. */
export function CustomerForm({ editing, onClose }: { editing?: Customer; onClose: () => void }) {
  const { t } = useI18n()
  const { shops, isAdmin } = useSession()
  const [name, setName] = useState(editing?.name ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [limit, setLimit] = useState(editing?.limitCents !== undefined ? String(editing.limitCents / 100) : '')
  const [shopId, setShopId] = useState(editing?.businessId ?? shops[0]?.id ?? '')
  const [bad, setBad] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const limitCents = limit.trim() === '' ? undefined : parseAmount(limit)
    if (!name.trim() || !shopId || limitCents === null) {
      setBad(true)
      return
    }
    if (saving) return
    setSaving(true)
    try {
      // The credit limit is the owner's decision; a worker's save keeps whatever was set.
      const input = { name, phone, limitCents: isAdmin ? limitCents : editing?.limitCents }
      if (editing) await updateCustomer(editing.id, input)
      else await addCustomer(shopId, input)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title={editing ? t('debts.edit') : t('debts.add')} onClose={onClose}>
      <form onSubmit={save} onChange={() => setBad(false)}>
        <label className="field">
          <span>{t('debts.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus />
        </label>
        <label className="field">
          <span>{t('onboard.phone')}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="07…" />
        </label>
        {isAdmin && (
          <label className="field">
            <span>{t('debts.limit')}</span>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" autoComplete="off" />
            <small>{t('debts.limitHint')}</small>
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
        {bad && (
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
