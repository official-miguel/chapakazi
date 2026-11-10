import { Plus, Store } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { bizTypeLabel } from '../bizTypes'
import { BusinessFields } from '../components/BusinessFields'
import { Sheet } from '../components/Sheet'
import type { BusinessType } from '../db'
import { addBusiness } from '../directory'
import { useI18n } from '../i18n'
import { useSession } from '../session'

/** Owner only: the businesses this person owns, and adding another one. */
export function BusinessesScreen() {
  const { t } = useI18n()
  const { dir, person } = useSession()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<BusinessType>('kiosk')
  const [saving, setSaving] = useState(false)

  if (!person) return null

  const ownedIds = new Set(
    dir.memberships.filter((m) => m.personId === person.id && m.role === 'admin' && !m.removedAt).map((m) => m.businessId),
  )
  const owned = dir.businesses.filter((b) => ownedIds.has(b.id))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving || !name.trim()) return
    setSaving(true)
    try {
      await addBusiness(person.id, name, type)
      setName('')
      setType('kiosk')
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h1 className="screen-title">{t('more.businesses')}</h1>

      <div className="list list-gap">
        {owned.map((b) => (
          <div key={b.id} className="list-row">
            <Store size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{b.name}</span>
              <span className="list-sub">{t(bizTypeLabel(b.type))}</span>
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
        <Plus size={22} aria-hidden /> {t('biz.add')}
      </button>

      {adding && (
        <Sheet title={t('biz.add')} onClose={() => setAdding(false)}>
          <form onSubmit={save}>
            <BusinessFields name={name} type={type} onName={setName} onType={setType} />
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
              {t('common.save')}
            </button>
          </form>
        </Sheet>
      )}
    </>
  )
}
