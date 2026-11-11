import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { db } from '../db'
import type { MpesaLink } from '../db'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { requestMpesa, validShortcode } from '../mpesa'
import { useSession } from '../session'
import { useSyncState } from '../sync'
import { useToast } from '../toast'

const statusTitle: Record<MpesaLink['status'], WordKey> = {
  requested: 'mpesa.requested',
  in_progress: 'mpesa.inProgress',
  active: 'mpesa.active',
  rejected: 'mpesa.rejected',
}
const statusText: Record<MpesaLink['status'], WordKey> = {
  requested: 'mpesa.requestedText',
  in_progress: 'mpesa.inProgressText',
  active: 'mpesa.activeText',
  rejected: 'mpesa.rejectedText',
}
const statusDot: Record<MpesaLink['status'], string> = {
  requested: 'dot dot-warn',
  in_progress: 'dot dot-warn',
  active: 'dot dot-on',
  rejected: 'dot dot-bad',
}

/** Owner only: ask for the shop's Till or Paybill to be connected, and see how the request is going. */
export function MpesaScreen() {
  const { t } = useI18n()
  const toast = useToast()
  const { person, shops } = useSession()
  const sync = useSyncState()
  const [shopId, setShopId] = useState(shops[0]?.id ?? '')
  const link = useLiveQuery(async () => (await db.mpesaLinks.where('businessId').equals(shopId).first()) ?? null, [shopId])
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<MpesaLink['kind']>('till')
  const [shortcode, setShortcode] = useState('')
  const [name, setName] = useState('')
  const [bad, setBad] = useState(false)

  if (!person || link === undefined) return null
  const showForm = link === null || editing

  const startEdit = () => {
    if (link) {
      setKind(link.kind)
      setShortcode(link.shortcode)
      setName(link.name)
    }
    setBad(false)
    setEditing(true)
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!validShortcode(shortcode) || !name.trim()) {
      setBad(true)
      return
    }
    await requestMpesa(shopId, { kind, shortcode, name }, person.id)
    setEditing(false)
    toast(t('mpesa.sent'))
  }

  return (
    <>
      <h1 className="screen-title">{t('mpesa.title')}</h1>

      {shops.length > 1 && (
        <div className="chips platform-filter">
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === shopId ? 'chip chip-on' : 'chip'}
              aria-pressed={s.id === shopId}
              onClick={() => {
                setShopId(s.id)
                setEditing(false)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <p className="card-note report-intro">{t('mpesa.intro')}</p>

      {/* The request travels through backup, so it cannot reach us from a phone with no account. */}
      {!sync.signedIn && <p className="warn-note">{t('mpesa.needAccount')}</p>}

      {link && !editing && (
        <section className="card">
          <p className="row">
            <span className={statusDot[link.status]} aria-hidden />
            <b>{t(statusTitle[link.status])}</b>
          </p>
          <p className="summary-text mpesa-status">{t(statusText[link.status])}</p>
          {link.adminNote && <p className="warn-note mpesa-note">{link.adminNote}</p>}
          <table className="compare cash-sum">
            <tbody>
              <tr>
                <th scope="row">{t(link.kind === 'till' ? 'mpesa.till' : 'mpesa.paybill')}</th>
                <td>{link.shortcode}</td>
              </tr>
              <tr>
                <th scope="row">{t('mpesa.name')}</th>
                <td>{link.name}</td>
              </tr>
            </tbody>
          </table>
          <button type="button" className="btn btn-quiet" onClick={startEdit}>
            {t('mpesa.change')}
          </button>
        </section>
      )}

      {showForm && (
        <form className="card" onSubmit={send} onChange={() => setBad(false)}>
          <div className="field">
            <span>{t('mpesa.kind')}</span>
            <div className="segmented">
              {(['till', 'paybill'] as const).map((k) => (
                <button key={k} type="button" className={k === kind ? 'segment segment-on' : 'segment'} aria-pressed={k === kind} onClick={() => setKind(k)}>
                  {t(k === 'till' ? 'mpesa.till' : 'mpesa.paybill')}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>{t('mpesa.number')}</span>
            <input value={shortcode} onChange={(e) => setShortcode(e.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" />
          </label>
          <label className="field">
            <span>{t('mpesa.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
            <small>{t('mpesa.nameHint')}</small>
          </label>
          {bad && (
            <p className="field-error" role="alert">
              {t('mpesa.bad')}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            {t('mpesa.send')}
          </button>
          {editing && (
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          )}
        </form>
      )}
    </>
  )
}
