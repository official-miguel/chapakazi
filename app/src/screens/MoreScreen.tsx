import { Banknote, ChartColumn, ChevronRight, FileText, Lock, ShieldCheck, Smartphone, Store, Truck, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BackupCard } from '../components/BackupCard'
import { useI18n } from '../i18n'
import type { Lang } from '../i18n'
import { usePlatformAdmin } from '../platform'
import { useSession } from '../session'
import { useOnline } from '../useOnline'

const languages: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'sw', name: 'Kiswahili' },
]

export function MoreScreen() {
  const { t, lang, setLang } = useI18n()
  const { isAdmin, lock } = useSession()
  const online = useOnline()
  const platformAdmin = usePlatformAdmin()

  return (
    <>
      <h1 className="screen-title">{t('nav.more')}</h1>

      <div className="list list-gap">
        <Link to="/cash-count" className="list-row">
          <Banknote size={24} aria-hidden />
          <span className="list-main">
            <span className="list-title">{t('cash.title')}</span>
          </span>
          <ChevronRight size={22} aria-hidden />
        </Link>
      </div>

      {isAdmin && (
        <div className="list list-gap">
          <Link to="/analysis" className="list-row">
            <ChartColumn size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('analysis.title')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
          <Link to="/health-report" className="list-row">
            <FileText size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('health.title')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
          <Link to="/suppliers" className="list-row">
            <Truck size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('sup.title')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
          <Link to="/mpesa" className="list-row">
            <Smartphone size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('mpesa.title')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
          <Link to="/businesses" className="list-row">
            <Store size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('more.businesses')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
          <Link to="/workers" className="list-row">
            <UserPlus size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('more.workers')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
        </div>
      )}

      {platformAdmin && (
        <div className="list list-gap">
          <Link to="/platform" className="list-row">
            <ShieldCheck size={24} aria-hidden />
            <span className="list-main">
              <span className="list-title">{t('platform.title')}</span>
            </span>
            <ChevronRight size={22} aria-hidden />
          </Link>
        </div>
      )}

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

      <p className="footnote">
        Chapa Kazi · {t('more.version')} {__APP_VERSION__}
      </p>
    </>
  )
}
