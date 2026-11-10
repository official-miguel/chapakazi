import { BookOpen, Check, ChevronDown, Home, Lock, Menu, Mic, Package, Users, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { useSession } from '../session'
import type { View } from '../session'
import { useToast } from '../toast'
import { useOnline } from '../useOnline'
import { Sheet } from './Sheet'

const tabs: { to: string; label: WordKey; icon: typeof Home }[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/ledger', label: 'nav.ledger', icon: BookOpen },
  { to: '/stock', label: 'nav.stock', icon: Package },
  { to: '/debts', label: 'nav.debts', icon: Users },
  { to: '/more', label: 'nav.more', icon: Menu },
]

export function Layout() {
  const { t } = useI18n()
  const toast = useToast()
  const online = useOnline()
  const { dir, person, view, business, views, lock, switchTo } = useSession()
  const [switching, setSwitching] = useState(false)

  if (!person || !view) return null

  const isOwnerSomewhere = views.some((v) => v.role === 'admin')
  const businessName = (v: View) =>
    v.businessId === 'all' ? t('switch.all') : (dir.businesses.find((b) => b.id === v.businessId)?.name ?? '')
  // An owner looking at their own shop "as a worker" is labelled so they know why things are hidden.
  const roleName = (v: View) =>
    v.role === 'admin' ? t('role.owner') : isOwnerSomewhere ? t('switch.workerView') : t('role.worker')

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="ctx-btn" onClick={() => setSwitching(true)}>
          <span className="ctx-text">
            <span className="ctx-name">{business?.name ?? t('switch.all')}</span>
            <span className="ctx-sub">
              {person.name} · {roleName(view)}
            </span>
          </span>
          <ChevronDown size={20} aria-hidden />
        </button>
        {!online && (
          <span className="pill pill-warn">
            <WifiOff size={14} aria-hidden /> {t('status.offline')}
          </span>
        )}
      </header>

      <main className="content">
        <Outlet />
      </main>

      <button
        type="button"
        className="mic"
        aria-label={t('mic.label')}
        onClick={() => toast(t('toast.voiceLater'))}
      >
        <Mic size={30} aria-hidden />
      </button>

      <nav className="bottombar">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className="tab">
            <Icon size={24} aria-hidden />
            <span>{t(label)}</span>
          </NavLink>
        ))}
      </nav>

      {switching && (
        <Sheet title={t('switch.title')} onClose={() => setSwitching(false)}>
          <div className="list">
            {views.map((v) => {
              const current = v.businessId === view.businessId && v.role === view.role
              return (
                <button
                  key={`${v.businessId}:${v.role}`}
                  type="button"
                  className="list-row"
                  aria-current={current || undefined}
                  onClick={() => {
                    switchTo(v)
                    setSwitching(false)
                  }}
                >
                  <span className="list-main">
                    <span className="list-title">{businessName(v)}</span>
                    <span className="list-sub">{roleName(v)}</span>
                  </span>
                  {current && <Check size={22} className="ink-green" aria-hidden />}
                </button>
              )
            })}
          </div>
          <button type="button" className="btn btn-quiet" onClick={lock}>
            <Lock size={20} aria-hidden /> {t('switch.lock')}
          </button>
        </Sheet>
      )}
    </div>
  )
}
