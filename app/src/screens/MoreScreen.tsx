import { Banknote, ChartColumn, CreditCard, ChevronRight, FileText, Inbox, Lock, LogOut, ShieldCheck, Smartphone, Store, Truck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AccountFailure, signOutAccount } from '../account'
import type { AccountError } from '../account'
import { BackupCard } from '../components/BackupCard'
import { useSyncState } from '../sync'
import { useI18n } from '../i18n'
import type { Lang, WordKey } from '../i18n'
import { usePlatformAdmin } from '../platform'
import { useSession } from '../session'
import { useOnline } from '../useOnline'

type MenuLink = { to: string; label: WordKey; icon: LucideIcon; owner?: boolean; superAdmin?: boolean }

// Everything the More menu can open. Owner-only pages are hidden from workers.
const menu: MenuLink[] = [
  { to: '/inbox', label: 'inbox.title', icon: Inbox },
  { to: '/cash-count', label: 'cash.title', icon: Banknote },
  { to: '/plan', label: 'plan.title', icon: CreditCard, owner: true },
  { to: '/analysis', label: 'analysis.title', icon: ChartColumn, owner: true },
  { to: '/health-report', label: 'health.title', icon: FileText, owner: true },
  { to: '/suppliers', label: 'sup.title', icon: Truck, owner: true },
  { to: '/mpesa', label: 'mpesa.title', icon: Smartphone, owner: true },
  { to: '/businesses', label: 'more.businesses', icon: Store, owner: true },
  { to: '/workers', label: 'more.workers', icon: UserPlus, owner: true },
  { to: '/platform', label: 'platform.title', icon: ShieldCheck, superAdmin: true },
]

const languages: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'sw', name: 'Kiswahili' },
]

export function MoreScreen() {
  const { t, lang, setLang } = useI18n()
  const { isAdmin, lock } = useSession()
  const online = useOnline()
  const platformAdmin = usePlatformAdmin()
  const sync = useSyncState()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<AccountError | null>(null)

  const links = menu
    .filter((m) => (!m.owner || isAdmin) && (!m.superAdmin || platformAdmin))
    .map((m) => ({ ...m, label: t(m.label) }))
    .sort((a, b) => a.label.localeCompare(b.label, lang === 'sw' ? 'sw' : 'en', { sensitivity: 'base' }))

  return (
    <>
      <h1 className="screen-title">{t('nav.more')}</h1>

      {/* One list, in alphabetical order of the words shown (so it re-sorts in Swahili). */}
      <div className="list list-gap">
        {links.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="list-row">
            <Icon size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{label}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
        ))}
      </div>

      <BackupCard />

      <section className="card">
        <h2 className="card-title">{t('more.language')}</h2>
        <div className="segmented">
          {languages.map(({ code, name }) => (
            <button
              key={code}
              type="button"
              className={code === lang ? 'segment segment-on' : 'segment'}
              aria-pressed={code === lang}
              onClick={() => setLang(code)}
            >
              {name}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">{t('more.connection')}</h2>
        <p className="row">
          <span className={online ? 'dot dot-on' : 'dot dot-warn'} aria-hidden />
          {online ? t('status.online') : t('status.offlineNote')}
        </p>
      </section>

      <button type="button" className="btn btn-quiet" onClick={lock}>
        <Lock size={20} aria-hidden /> {t('switch.lock')}
      </button>

      {sync.signedIn && (
        <>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={signingOut}
            onClick={async () => {
              if (!window.confirm(t('more.signOutWarn'))) return
              setSignOutError(null)
              setSigningOut(true)
              try {
                // Clears this phone and reloads the app on its first page.
                await signOutAccount()
              } catch (failure) {
                setSignOutError(failure instanceof AccountFailure ? failure.key : 'err.other')
                setSigningOut(false)
              }
            }}
          >
            <LogOut size={20} aria-hidden /> {t('more.signOut')}
          </button>
          {signOutError && (
            <p className="field-error" role="alert">
              {t(signOutError)}
            </p>
          )}
        </>
      )}

      <p className="footnote">
        Chapa Biz · {t('more.version')} {__APP_VERSION__}
      </p>
    </>
  )
}
