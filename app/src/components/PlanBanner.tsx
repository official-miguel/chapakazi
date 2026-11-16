import { Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useSession } from '../session'
import { usePlan } from '../subscription/api'

/** The in-app reminder, from 1 day before the plan ends. No SMS, so it costs nothing. */
export function PlanBanner() {
  const { t } = useI18n()
  const { views, business } = useSession()
  const isOwner = views.some((v) => v.role === 'admin')
  // The app's gate keeps the plan fresh; this only reads what it already knows.
  const { endsSoon, status } = usePlan(isOwner ? null : (business?.id ?? null), false)
  if (!endsSoon || !status) return null

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
