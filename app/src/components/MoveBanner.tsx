import { ExternalLink, MoveRight } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { NEW_ADDRESS, onOldAddress } from '../moveAddress'
import { useSession } from '../session'
import { backupAvailable } from '../supabase'
import { useSyncState } from '../sync'
import { useOnline } from '../useOnline'
import { OwnerAccountForm } from './AccountForms'
import { usePendingCount } from './BackupCard'
import { Sheet } from './Sheet'

// On the old address, this notice walks people across to the new one without losing anything:
// a phone keeps its records per address, so records are backed up to an account first, then
// they sign in at the new address.

export function MoveBanner() {
  const { t } = useI18n()
  const { person, isAdmin } = useSession()
  const sync = useSyncState()
  const pending = usePendingCount()
  const online = useOnline()
  const [creating, setCreating] = useState(false)

  if (!onOldAddress() || !backupAvailable || !person) return null

  const isWorkerLogin = sync.email?.endsWith('.invalid') ?? false
  const host = NEW_ADDRESS.replace('https://', '')

  let text: string
  let action: React.ReactNode = null
  if (!sync.signedIn) {
    // Records live only on this phone: back them up first, or they stay behind.
    text = t(isAdmin ? 'move.noAccount' : 'move.askOwner', { host })
    if (isAdmin) {
      action = (
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('backup.create')}
        </button>
      )
    }
  } else if (isWorkerLogin) {
    // A worker never had a password, so they join the shop again with a new code.
    text = t('move.worker', { host })
  } else if (pending > 0 || !online) {
    text = t('move.wait', { host, n: pending })
  } else {
    text = t('move.ready', { host, email: sync.email ?? '' })
    action = (
      <a className="btn btn-primary" href={NEW_ADDRESS} target="_blank" rel="noopener">
        <ExternalLink size={20} aria-hidden /> {t('move.open', { host })}
      </a>
    )
  }

  return (
    <section className="move-banner" role="status">
      <p className="move-title">
        <MoveRight size={20} aria-hidden /> {t('move.title', { host })}
      </p>
      <p className="move-text">{text}</p>
      {action}
      {creating && (
        <Sheet title={`${t('backup.create')} / ${t('account.signIn')}`} onClose={() => setCreating(false)}>
          <OwnerAccountForm personId={person.id} onDone={() => setCreating(false)} />
        </Sheet>
      )}
    </section>
  )
}
