import { KeyRound, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { bizTypeLabel } from '../bizTypes'
import type { BusinessType } from '../db'
import { useI18n } from '../i18n'
import { parseAmount } from '../ledger'
import {
  isActive,
  loadCallbackAddresses,
  loadDarajaStatus,
  loadMpesaRequests,
  loadOverview,
  saveDarajaKeys,
  saveGeminiKey,
  sendTestPayment,
  setMpesaStatus,
} from '../platform'
import type { DarajaEnv, DarajaStatus, MpesaRequest, Overview } from '../platform'
import { useTimeFormat } from '../useTimeFormat'

type Tab = 'shops' | 'people' | 'mpesa' | 'settings'

/** Platform admin only: who is using Chapa Kazi and how active they are. Activity only, no money. */
export function PlatformScreen() {
  const { t } = useI18n()
  const { dateTime } = useTimeFormat()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('shops')
  const [activeOnly, setActiveOnly] = useState(true)
  const [key, setKey] = useState('')
  const [keyState, setKeyState] = useState<'idle' | 'saving' | 'saved' | 'bad'>('idle')
  const [requests, setRequests] = useState<MpesaRequest[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [testAmounts, setTestAmounts] = useState<Record<string, string>>({})
  const [testSent, setTestSent] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<{ confirm: string; validate: string } | null>(null)
  const [daraja, setDaraja] = useState<DarajaStatus>({ set: false })
  const [darajaEnv, setDarajaEnv] = useState<DarajaEnv>('sandbox')
  const [darajaKey, setDarajaKey] = useState('')
  const [darajaSecret, setDarajaSecret] = useState('')
  const [darajaState, setDarajaState] = useState<'idle' | 'saving' | 'saved' | 'bad'>('idle')

  const refresh = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      setData(await loadOverview())
      setRequests(await loadMpesaRequests())
      setDaraja(await loadDarajaStatus())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void refresh(), [refresh])

  const when = (at: string | null) => (at ? dateTime(Date.parse(at)) : t('platform.never'))

  const saveDaraja = async (e: FormEvent) => {
    e.preventDefault()
    if (darajaState === 'saving') return
    setDarajaState('saving')
    try {
      await saveDarajaKeys(darajaEnv, darajaKey, darajaSecret)
      setDarajaKey('')
      setDarajaSecret('')
      setDarajaState('saved')
      setDaraja(await loadDarajaStatus())
    } catch {
      setDarajaState('bad')
    }
  }

  const saveKey = async (e: FormEvent) => {
    e.preventDefault()
    if (keyState === 'saving') return
    setKeyState('saving')
    try {
      await saveGeminiKey(key)
      setKey('')
      setKeyState('saved')
      await refresh()
    } catch {
      setKeyState('bad')
    }
  }

  const moveRequest = async (r: MpesaRequest, status: MpesaRequest['status']) => {
    await setMpesaStatus(r.business_id, status, notes[r.business_id] ?? r.admin_note ?? '')
    await refresh()
  }
  const waiting = requests.filter((r) => r.status === 'requested').length

  const sendTest = async (r: MpesaRequest) => {
    const cents = parseAmount(testAmounts[r.business_id] ?? '')
    if (cents === null) return
    await sendTestPayment(r.business_id, cents)
    setTestAmounts({ ...testAmounts, [r.business_id]: '' })
    setTestSent(r.business_id)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'shops', label: t('platform.shops') },
    { id: 'people', label: t('platform.people') },
    { id: 'mpesa', label: waiting > 0 ? `M-Pesa (${waiting})` : 'M-Pesa' },
    { id: 'settings', label: t('platform.settings') },
  ]
  const people = data?.people.filter((p) => !activeOnly || isActive(p.last_at)) ?? []
  const shops = data?.shops.filter((s) => !activeOnly || isActive(s.last_at)) ?? []

  return (
    <>
      <div className="customer-head">
        <h1 className="screen-title">{t('platform.title')}</h1>
        <button type="button" className="icon-btn" aria-label={t('platform.refresh')} disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={22} aria-hidden />
        </button>
      </div>

      {failed && (
        <p className="warn-note" role="alert">
          {t('platform.failed')}
        </p>
      )}

      {data && (
        <>
          <section className="totals">
            <div className="total-card">
              <span className="total-label">{t('platform.shops')}</span>
              <span className="total-value">{data.totals.shops}</span>
              <span className="list-sub">{t('platform.activeWeek', { n: data.totals.shops_active_7d })}</span>
              <span className="list-sub">{t('platform.newWeek', { n: data.totals.shops_new_7d })}</span>
            </div>
            <div className="total-card">
              <span className="total-label">{t('platform.people')}</span>
              <span className="total-value">{data.totals.people}</span>
              <span className="list-sub">{t('platform.activeWeek', { n: data.totals.people_active_7d })}</span>
              <span className="list-sub">{t('platform.logins', { n: data.totals.logins })}</span>
            </div>
            <div className="total-card">
              <span className="total-label">{t('platform.entries')}</span>
              <span className="total-value">{data.totals.entries}</span>
              <span className="list-sub">{t('platform.actionsDay', { n: data.totals.actions_24h })}</span>
              <span className="list-sub">{t('platform.actionsWeek', { n: data.totals.actions_7d })}</span>
            </div>
          </section>
          <p className="card-note platform-note">{t('platform.privacy')}</p>

          <div className="segmented segmented-4" role="tablist">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                className={tab === x.id ? 'segment segment-on' : 'segment'}
                onClick={() => setTab(x.id)}
              >
                {x.label}
              </button>
            ))}
          </div>

          {(tab === 'shops' || tab === 'people') && (
            <div className="chips platform-filter">
              <button type="button" className={activeOnly ? 'chip chip-on' : 'chip'} aria-pressed={activeOnly} onClick={() => setActiveOnly(true)}>
                {t('platform.activeOnly')}
              </button>
              <button type="button" className={activeOnly ? 'chip' : 'chip chip-on'} aria-pressed={!activeOnly} onClick={() => setActiveOnly(false)}>
                {t('platform.all')}
              </button>
            </div>
          )}

          {tab === 'shops' && (
            <div className="list">
              {shops.length === 0 && <p className="hint-note">{t('platform.none')}</p>}
              {shops.map((s) => (
                <div key={s.id} className="list-row">
                  <span className={isActive(s.last_at) ? 'dot dot-on' : 'dot dot-off'} aria-hidden />
                  <span className="list-main">
                    <span className="list-title">{s.name ?? '?'}</span>
                    <span className="list-sub">
                      {[s.type ? t(bizTypeLabel(s.type as BusinessType)) : null, s.owner_name, s.owner_email].filter(Boolean).join(' · ')}
                    </span>
                    <span className="list-sub">
                      {t('platform.shopCounts', { workers: s.workers, items: s.items, customers: s.customers, entries: s.entries })}
                    </span>
                    <span className="list-sub">{t('platform.lastActive', { when: when(s.last_at) })}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'people' && (
            <div className="list">
              {people.length === 0 && <p className="hint-note">{t('platform.none')}</p>}
              {people.map((p) => (
                <div key={`${p.id}:${p.shop}`} className="list-row">
                  <span className={isActive(p.last_at) ? 'dot dot-on' : 'dot dot-off'} aria-hidden />
                  <span className="list-main">
                    <span className="list-title">{p.name ?? '?'}</span>
                    <span className="list-sub">
                      {[t(p.role === 'admin' ? 'role.owner' : 'role.worker'), p.shop, p.email].filter(Boolean).join(' · ')}
                    </span>
                    <span className="list-sub">
                      {t('platform.lastActive', { when: when(p.last_at) })} · {t('platform.actionsWeek', { n: p.actions_7d })}
                    </span>
                  </span>
                  <span className="row-end">
                    {p.removed ? (
                      <span className="tag tag-red">{t('platform.removed')}</span>
                    ) : (
                      !p.has_login && <span className="tag">{t('platform.sharedPhone')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'mpesa' && (
            <div className="list">
              <p className="card-note platform-note">{t('platform.mpesaNote')}</p>
              {requests.length === 0 && <p className="hint-note">{t('platform.mpesaNone')}</p>}
              {requests.map((r) => (
                <div key={r.business_id} className="worker-card">
                  <div className="worker-head">
                    <span className={r.status === 'requested' ? 'dot dot-warn' : r.status === 'rejected' ? 'dot dot-bad' : 'dot dot-on'} aria-hidden />
                    <span className="list-main">
                      <span className="list-title">{r.shop ?? '?'}</span>
                      <span className="list-sub">
                        {t(r.kind === 'till' ? 'mpesa.till' : 'mpesa.paybill')} {r.shortcode} · {r.name}
                      </span>
                      <span className="list-sub">{[r.owner_email, when(r.changed_at)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="tag">{t(`platform.mpesa_${r.status}`)}</span>
                  </div>
                  <label className="field platform-key">
                    <span>{t('platform.mpesaMessage')}</span>
                    <input
                      value={notes[r.business_id] ?? r.admin_note ?? ''}
                      onChange={(e) => setNotes({ ...notes, [r.business_id]: e.target.value })}
                      maxLength={160}
                      autoComplete="off"
                    />
                  </label>
                  <div className="btn-trio">
                    <button type="button" className="btn btn-quiet btn-small" disabled={r.status === 'in_progress'} onClick={() => void moveRequest(r, 'in_progress')}>
                      {t('platform.mpesaStart')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-small ink-green" disabled={r.status === 'active'} onClick={() => void moveRequest(r, 'active')}>
                      {t('platform.mpesa_active')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-small ink-red" disabled={r.status === 'rejected'} onClick={() => void moveRequest(r, 'rejected')}>
                      {t('platform.mpesaReject')}
                    </button>
                  </div>
                  <div className="order-row">
                    <span className="list-main">
                      <span className="list-sub">{testSent === r.business_id ? t('platform.testSent') : t('platform.testHint')}</span>
                    </span>
                    <input
                      className="order-qty"
                      value={testAmounts[r.business_id] ?? ''}
                      onChange={(e) => {
                        setTestAmounts({ ...testAmounts, [r.business_id]: e.target.value })
                        setTestSent(null)
                      }}
                      inputMode="decimal"
                      placeholder="KSh"
                      aria-label={t('platform.testSend')}
                    />
                    <button type="button" className="link-btn" onClick={() => void sendTest(r)}>
                      {t('platform.testSend')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'settings' && (
            <section className="card">
              <h2 className="card-title">{t('platform.daraja')}</h2>
              <p className="row">
                <KeyRound size={20} aria-hidden />
                <span>
                  {daraja.set
                    ? t('platform.darajaSet', {
                        env: t(daraja.env === 'production' ? 'platform.darajaLive' : 'platform.darajaTest'),
                        hint: daraja.hint ?? '',
                        when: when(daraja.updated_at ?? null),
                      })
                    : t('platform.darajaNone')}
                </span>
              </p>
              <p className="card-note">{t('platform.darajaNote')}</p>
              <form onSubmit={saveDaraja} onChange={() => setDarajaState('idle')}>
                <div className="field platform-key">
                  <span>{t('platform.darajaEnv')}</span>
                  <div className="segmented">
                    {(['sandbox', 'production'] as const).map((env) => (
                      <button key={env} type="button" className={env === darajaEnv ? 'segment segment-on' : 'segment'} aria-pressed={env === darajaEnv} onClick={() => setDarajaEnv(env)}>
                        {t(env === 'production' ? 'platform.darajaLive' : 'platform.darajaTest')}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Consumer Key</span>
                  <input type="password" value={darajaKey} onChange={(e) => setDarajaKey(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
                <label className="field">
                  <span>Consumer Secret</span>
                  <input type="password" value={darajaSecret} onChange={(e) => setDarajaSecret(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
                {darajaState === 'bad' && (
                  <p className="field-error" role="alert">
                    {t('platform.keyBad')}
                  </p>
                )}
                {darajaState === 'saved' && <p className="card-note">{t('entry.saved')}</p>}
                <button type="submit" className="btn btn-primary" disabled={darajaState === 'saving' || darajaKey.trim().length < 16 || darajaSecret.trim().length < 16}>
                  {t('common.save')}
                </button>
              </form>
            </section>
          )}

          {tab === 'settings' && (
            <section className="card">
              <h2 className="card-title">{t('platform.callbackTitle')}</h2>
              <p className="card-note">{t('platform.callbackNote')}</p>
              {addresses ? (
                <pre className="order-text platform-key">
                  {`Confirmation:\n${addresses.confirm}\n\nValidation:\n${addresses.validate}`}
                </pre>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => void loadCallbackAddresses().then(setAddresses)}>
                  {t('platform.callbackShow')}
                </button>
              )}
            </section>
          )}

          {tab === 'settings' && (
            <section className="card">
              <h2 className="card-title">{t('platform.gemini')}</h2>
              <p className="row">
                <KeyRound size={20} aria-hidden />
                <span>
                  {data.gemini.set
                    ? t('platform.keySet', { hint: data.gemini.hint ?? '', when: when(data.gemini.updated_at ?? null) })
                    : t('platform.keyNone')}
                </span>
              </p>
              <p className="card-note">{t('platform.keyNote')}</p>
              <form onSubmit={saveKey}>
                <label className="field platform-key">
                  <span>{t('platform.keyNew')}</span>
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value)
                      setKeyState('idle')
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                {keyState === 'bad' && (
                  <p className="field-error" role="alert">
                    {t('platform.keyBad')}
                  </p>
                )}
                {keyState === 'saved' && <p className="card-note">{t('entry.saved')}</p>}
                <button type="submit" className="btn btn-primary" disabled={keyState === 'saving' || key.trim().length < 20}>
                  {t('common.save')}
                </button>
              </form>
            </section>
          )}

          <p className="footnote">{t('platform.asOf', { when: when(data.generated_at) })}</p>
        </>
      )}
    </>
  )
}
