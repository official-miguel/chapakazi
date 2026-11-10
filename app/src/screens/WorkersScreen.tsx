import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { EmptyState } from '../components/EmptyState'
import { Sheet } from '../components/Sheet'
import type { Membership, Person } from '../db'
import { addWorker, removeWorker, renewInvite } from '../directory'
import { useI18n } from '../i18n'
import { useSession } from '../session'

type WorkerRow = { membership: Membership; person: Person; shopName: string }

/** Owner only: who works in which shop. Add a worker, see their invite code, or remove them. */
export function WorkersScreen() {
  const { t } = useI18n()
  const { dir, person, business } = useSession()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<WorkerRow | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [shopId, setShopId] = useState('')
  const [saving, setSaving] = useState(false)

  if (!person) return null

  // The shops this owner manages. In a single-shop view only that shop is shown.
  const ownedIds = new Set(
    dir.memberships.filter((m) => m.personId === person.id && m.role === 'admin' && !m.removedAt).map((m) => m.businessId),
  )
  const shops = dir.businesses.filter((b) => ownedIds.has(b.id) && (!business || b.id === business.id))
  const targetShopId = shops.some((s) => s.id === shopId) ? shopId : (shops[0]?.id ?? '')

  const workers: WorkerRow[] = dir.memberships
    .filter((m) => m.role === 'worker' && !m.removedAt && shops.some((s) => s.id === m.businessId))
    .flatMap((membership) => {
      const p = dir.people.find((x) => x.id === membership.personId)
      const shop = shops.find((s) => s.id === membership.businessId)
      return p && shop ? [{ membership, person: p, shopName: shop.name }] : []
    })
    .sort((a, b) => a.membership.createdAt - b.membership.createdAt)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving || !name.trim() || !targetShopId) return
    setSaving(true)
    try {
      await addWorker(targetShopId, name, phone)
      setName('')
      setPhone('')
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h1 className="screen-title">{t('more.workers')}</h1>

      {workers.length === 0 ? (
        <EmptyState icon={<Users size={40} />} title={t('workers.empty')} hint={t('workers.emptyHint')} />
      ) : (
        <div className="list list-gap">
          {workers.map((w) => (
            <div key={w.membership.id} className="worker-card">
              <div className="worker-head">
                <span className="avatar" aria-hidden>
                  {w.person.name.charAt(0).toUpperCase()}
                </span>
                <span className="list-main">
                  <span className="list-title">{w.person.name}</span>
                  <span className="list-sub">
                    {w.shopName}
                    {w.membership.inviteCode ? '' : ` · ${t('workers.active')}`}
                  </span>
                </span>
                <button type="button" className="link-danger" onClick={() => setRemoving(w)}>
                  {t('workers.remove')}
                </button>
              </div>
              {!w.membership.inviteCode && (
                <button type="button" className="link-btn" onClick={() => void renewInvite(w.membership.id)}>
                  {t('workers.newCode')}
                </button>
              )}
              {w.membership.inviteCode && (
                <div className="invite">
                  <span className="invite-label">{t('workers.code')}</span>
                  <span className="invite-code">{w.membership.inviteCode}</span>
                  <p>{t('workers.codeHelp', { name: w.person.name })}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
        <Plus size={22} aria-hidden /> {t('workers.add')}
      </button>

      {adding && (
        <Sheet title={t('workers.add')} onClose={() => setAdding(false)}>
          <form onSubmit={save}>
            <label className="field">
              <span>{t('workers.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
            </label>
            <label className="field">
              <span>{t('onboard.phone')}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                inputMode="tel"
                placeholder="07…"
              />
            </label>
            {shops.length > 1 && (
              <div className="field">
                <span>{t('workers.shop')}</span>
                <div className="chips">
                  {shops.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={s.id === targetShopId ? 'chip chip-on' : 'chip'}
                      aria-pressed={s.id === targetShopId}
                      onClick={() => setShopId(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
              {t('common.save')}
            </button>
          </form>
        </Sheet>
      )}

      {removing && (
        <Sheet title={t('workers.removeTitle')} onClose={() => setRemoving(null)}>
          <p className="sheet-text">
            {t('workers.removeConfirm', { name: removing.person.name, shop: removing.shopName })}
          </p>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              await removeWorker(removing.membership.id)
              setRemoving(null)
            }}
          >
            {t('workers.remove')}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setRemoving(null)}>
            {t('common.cancel')}
          </button>
        </Sheet>
      )}
    </>
  )
}
