import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, CloudUpload, KeyRound, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { backupAvailable } from '../supabase'
import { countPending, syncNow, useSyncState } from '../sync'
import { useOnline } from '../useOnline'
import { useTimeFormat } from '../useTimeFormat'
import { JoinShopForm, OwnerAccountForm } from './AccountForms'
import { Sheet } from './Sheet'

/** How many records are waiting to be backed up. Updates as records are saved and sent. */
export function usePendingCount(): number {
  return useLiveQuery(countPending) ?? 0
}

/**
 * On the More screen: whether this phone is backed up, and the way to set that up.
 * `showJoin` adds the way for someone with no account to join a shop with an invite code.
 */
export function BackupCard({ showJoin = true }: { showJoin?: boolean }) {
  const { t } = useI18n()
  const { person, isAdmin } = useSession()
  const sync = useSyncState()
  const pending = usePendingCount()
  const online = useOnline()
  const { dateTime } = useTimeFormat()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  if (!backupAvailable || !person) return null

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
        {showJoin && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setJoining(true)}
          >
            <KeyRound size={18} aria-hidden /> {t('account.noAccountJoin')}
          </button>
        )}

        {joining && (
          <Sheet title={t('account.joinTitle')} onClose={() => setJoining(false)}>
            <JoinShopForm />
          </Sheet>
        )}

        {creating && (
          <Sheet title={`${t('backup.create')} / ${t('account.signIn')}`} onClose={() => setCreating(false)}>
            <OwnerAccountForm personId={person.id} onDone={() => setCreating(false)} />
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
      {/* The server's own reason, so a failed sync can be reported and fixed. */}
      {online && sync.failed && sync.problems.length > 0 && (
        <details className="sync-problems">
          <summary>{t('backup.why')}</summary>
          <ul>
            {sync.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className="btn btn-quiet" disabled={sync.busy || !online} onClick={() => void syncNow()}>
        <RefreshCw size={20} aria-hidden /> {t('backup.syncNow')}
      </button>
    </section>
  )
}
