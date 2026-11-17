import { KeyRound, Lock, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { JoinShopForm, OwnerAccountForm } from '../components/AccountForms'
import { FREE_ENTRY_LIMIT } from '../freeLimit'
import { useI18n } from '../i18n'
import { useSession } from '../session'

/**
 * Shown, instead of the app, once a phone with no account has used its free entries.
 * The owner creates an account (their records are kept and backed up) or signs in to one;
 * someone who works in a shop can join it with the owner's invite code instead.
 */
export function AccountRequiredScreen() {
  const { t } = useI18n()
  const { person, isAdmin, lock } = useSession()
  const [joining, setJoining] = useState(false)
  if (!person) return null

  return (
    <div className="app plan-locked">
      <main className="content">
        <section className="card plan-lock-card">
          <UserPlus size={36} aria-hidden />
          <h1 className="screen-title">{t('free.title', { n: FREE_ENTRY_LIMIT })}</h1>
          <p className="summary-text">{t(isAdmin ? 'free.text' : 'free.textWorker')}</p>
        </section>

        {isAdmin && !joining && (
          <section className="card">
            <h2 className="card-title">{t('free.formTitle')}</h2>
            <OwnerAccountForm personId={person.id} autoFocus={false} />
            <p className="card-note">{t('free.trialNote')}</p>
          </section>
        )}

        {joining ? (
          <section className="card">
            <h2 className="card-title">{t('account.joinTitle')}</h2>
            <JoinShopForm />
            <button type="button" className="btn btn-quiet" onClick={() => setJoining(false)}>
              {t('common.back')}
            </button>
          </section>
        ) : (
          <button type="button" className="link-btn" onClick={() => setJoining(true)}>
            <KeyRound size={18} aria-hidden /> {t('account.noAccountJoin')}
          </button>
        )}

        <button type="button" className="btn btn-quiet" onClick={lock}>
          <Lock size={20} aria-hidden /> {t('switch.lock')}
        </button>
      </main>
    </div>
  )
}
