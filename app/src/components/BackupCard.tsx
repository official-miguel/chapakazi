import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, CloudUpload, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { AccountFailure, createOwnerAccount, signInReplacingPhone } from '../account'
import type { AccountError } from '../account'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { backupAvailable } from '../supabase'
import { countPending, syncNow, useSyncState } from '../sync'
import { useOnline } from '../useOnline'
import { useTimeFormat } from '../useTimeFormat'
import { Sheet } from './Sheet'

/** How many records are waiting to be backed up. Updates as records are saved and sent. */
export function usePendingCount(): number {
  return useLiveQuery(countPending) ?? 0
}

/** On the More screen: whether this phone is backed up, and the way to set that up. */
export function BackupCard() {
  const { t } = useI18n()
  const { person, isAdmin } = useSession()
  const sync = useSyncState()
  const pending = usePendingCount()
  const online = useOnline()
  const { dateTime } = useTimeFormat()
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<'create' | 'signin'>('create')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<AccountError | null>(null)
  const [working, setWorking] = useState(false)

  if (!backupAvailable || !person) return null

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (working) return
    setWorking(true)
    setError(null)
    try {
      if (mode === 'signin') {
        if (!window.confirm(t('backup.signInWarn'))) return
        // Clears this phone's records and reloads the app with the account's own.
        await signInReplacingPhone(email, password)
        return
      }
      await createOwnerAccount(email, password, person.id)
      setCreating(false)
      setPassword('')
    } catch (failure) {
      setError(failure instanceof AccountFailure ? failure.key : 'err.other')
    } finally {
      setWorking(false)
    }
  }

  if (!sync.signedIn) {
    return (
      <section className="card">
        <h2 className="card-title">{t('backup.title')}</h2>
        <p className="row">
          <CloudOff size={20} className="ink-amber" aria-hidden />
          <span>{isAdmin ? t('backup.none') : t('backup.askOwner')}</span>
        </p>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <CloudUpload size={22} aria-hidden /> {t('backup.create')} / {t('account.signIn')}
          </button>
        )}

        {creating && (
          <Sheet title={`${t('backup.create')} / ${t('account.signIn')}`} onClose={() => setCreating(false)}>
            <div className="segmented">
              {(['create', 'signin'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={m === mode ? 'segment segment-on' : 'segment'}
                  aria-pressed={m === mode}
                  onClick={() => {
                    setMode(m)
                    setError(null)
                  }}
                >
                  {m === 'create' ? t('backup.create') : t('account.signIn')}
                </button>
              ))}
            </div>
            <form onSubmit={create}>
              <label className="field">
                <span>{t('backup.email')}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
              </label>
              <label className="field">
                <span>{t('backup.password')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signin' ? undefined : 8}
                  required
                />
              </label>
              {error && (
                <p className="field-error" role="alert">
                  {t(error)}
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={working}>
                {mode === 'signin' ? t('account.signIn') : t('backup.create')}
              </button>
            </form>
          </Sheet>
        )}
      </section>
    )
  }

  // A worker's own phone signs in with a made-up address, which is not worth showing.
  const isWorkerLogin = sync.email?.endsWith('.invalid') ?? false
  const status = !online
    ? t('backup.offline')
    : sync.busy
      ? t('backup.syncing')
      : sync.failed
        ? t('backup.error')
        : pending > 0
          ? t('backup.pending', { n: pending })
          : t('backup.allSaved')

  return (
    <section className="card">
      <h2 className="card-title">{t('backup.title')}</h2>
      <p className="row">
        <span className={!online || sync.failed || pending > 0 ? 'dot dot-warn' : 'dot dot-on'} aria-hidden />
        <span>{status}</span>
      </p>
      <p className="card-note">
        {isWorkerLogin ? t('backup.workerPhone') : t('backup.signedIn', { email: sync.email ?? '' })}
        {sync.lastOkAt ? ` · ${t('backup.last', { time: dateTime(sync.lastOkAt) })}` : ''}
      </p>
      <button type="button" className="btn btn-quiet" disabled={sync.busy || !online} onClick={() => void syncNow()}>
        <RefreshCw size={20} aria-hidden /> {t('backup.syncNow')}
      </button>
    </section>
  )
}
