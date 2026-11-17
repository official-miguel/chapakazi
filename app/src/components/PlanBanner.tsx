import { Clock, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FREE_ENTRY_LIMIT, useFreeEntries } from '../freeLimit'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { usePlan } from '../subscription/api'
import { formatCountdown } from '../subscription/gate'

/**
 * The in-app reminders at the top of every page (no SMS, so they cost nothing):
 * the minutes left after the plan ended, the plan ending within a day, or, on a phone with no
 * account, how many free entries are left.
 */
export function PlanBanner() {
  const { t } = useI18n()
  const { views, business, isAdmin } = useSession()
  const isOwner = views.some((v) => v.role === 'admin')
  // The app's gate keeps the plan fresh; this only reads what it already knows.
  const { endsSoon, inGrace, graceUntil, status } = usePlan(isOwner ? null : (business?.id ?? null), false)
  const free = useFreeEntries()

  // A clock for the countdown, only while the minutes are running.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!inGrace) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [inGrace])

  if (inGrace && graceUntil !== null) {
    const left = formatCountdown(graceUntil - now)
    return isOwner ? (
      <Link to="/plan" className="plan-banner plan-banner-grace" role="status">
        <Clock size={20} aria-hidden />
        <span>{t('grace.bannerOwner', { time: left })}</span>
      </Link>
    ) : (
      <p className="plan-banner plan-banner-grace" role="status">
        <Clock size={20} aria-hidden />
        <span>{t('grace.bannerWorker', { time: left })}</span>
      </p>
    )
  }

  if (endsSoon && status) {
    const hours = Math.max(1, Math.round((new Date(status.expires_at).getTime() - Date.now()) / 3_600_000))
    return isOwner ? (
      <Link to="/plan" className="plan-banner">
        <Clock size={20} aria-hidden />
        <span>{t('plan.bannerOwner', { h: hours })}</span>
      </Link>
    ) : (
      <p className="plan-banner">
        <Clock size={20} aria-hidden />
        <span>{t('plan.bannerWorker', { h: hours })}</span>
      </p>
    )
  }

  if (free.applies && !free.reached) {
    const text = t('free.banner', { n: free.left, total: FREE_ENTRY_LIMIT })
    return isAdmin ? (
      <Link to="/more" className="plan-banner plan-banner-free">
        <UserPlus size={20} aria-hidden />
        <span>{text}</span>
      </Link>
    ) : (
      <p className="plan-banner plan-banner-free">
        <UserPlus size={20} aria-hidden />
        <span>{text}</span>
      </p>
    )
  }

  return null
}
