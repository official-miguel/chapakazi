import { ChevronRight, Lock, Store, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { Lang } from '../i18n'
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

  return (
    <>
      <h1 className="screen-title">{t('nav.more')}</h1>

      {isAdmin && (
        <div className="list list-gap">
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
