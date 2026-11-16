import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '../i18n'
import { loadStkStatus, saveStkSettings } from '../subscription/admin'
import type { StkStatus } from '../subscription/admin'
import { useTimeFormat } from '../useTimeFormat'

/**
 * Super admin > Settings: where owners' plan payments go (your Paybill or Till) and its
 * Lipa Na M-Pesa Online passkey. The passkey is write-only: saved encrypted, never shown again.
 */
export function StkSettingsCard() {
  const { t } = useI18n()
  const { dateTime } = useTimeFormat()
  const [status, setStatus] = useState<StkStatus>({ set: false })
  const [till, setTill] = useState(false)
  const [shortcode, setShortcode] = useState('')
  const [store, setStore] = useState('')
  const [passkey, setPasskey] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'bad'>('idle')

  useEffect(() => {
    loadStkStatus()
      .then(setStatus)
      .catch(() => undefined)
  }, [])

  const codeOk = /^\d{5,8}$/.test(shortcode.trim())
  const storeOk = !till || /^\d{5,8}$/.test(store.trim())
  const ready = codeOk && storeOk && passkey.trim().length >= 20

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || state === 'saving') return
    setState('saving')
    try {
      await saveStkSettings(shortcode, passkey, till, store)
      setPasskey('')
      setState('saved')
      setStatus(await loadStkStatus())
    } catch {
      setState('bad')
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">{t('admin.stkTitle')}</h2>
      <p className="row">
        <KeyRound size={20} aria-hidden />
        <span>
          {status.set
            ? t('admin.stkSet', {
                kind: t(status.type === 'till' ? 'mpesa.till' : 'mpesa.paybill'),
                code: status.shortcode ?? '',
                when: status.updated_at ? dateTime(Date.parse(status.updated_at)) : '',
              })
            : t('admin.stkNone')}
        </span>
      </p>
      <p className="card-note">{t('admin.stkNote')}</p>
      <form onSubmit={save} onChange={() => setState('idle')}>
        <div className="field platform-key">
          <span>{t('mpesa.kind')}</span>
          <div className="segmented">
            {([false, true] as const).map((isTill) => (
              <button key={String(isTill)} type="button" className={isTill === till ? 'segment segment-on' : 'segment'} aria-pressed={isTill === till} onClick={() => setTill(isTill)}>
                {t(isTill ? 'mpesa.till' : 'mpesa.paybill')}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t(till ? 'admin.tillNumber' : 'admin.paybillNumber')}</span>
          <input value={shortcode} onChange={(e) => setShortcode(e.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" placeholder="174379" />
        </label>
        {till && (
          <label className="field">
            <span>{t('admin.storeNumber')}</span>
            <input value={store} onChange={(e) => setStore(e.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" />
          </label>
        )}
        <label className="field">
          <span>{t('admin.passkey')}</span>
          <input type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {state === 'bad' && <p className="field-error" role="alert">{t('admin.stkBad')}</p>}
        {state === 'saved' && <p className="card-note">{t('entry.saved')}</p>}
        <button type="submit" className="btn btn-primary" disabled={!ready || state === 'saving'}>
          {t('common.save')}
        </button>
      </form>
    </section>
  )
}
