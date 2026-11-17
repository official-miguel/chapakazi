import { CloudOff, Lock, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { useSession } from '../session'

/**
 * Shown while a phone with an account has never yet heard where its plan stands. Every account
 * is on a plan (the free trial, or a paid one), and the server starts the trial on this first
 * check, so the app opens only once the answer arrives.
 */
export function PlanCheckScreen({ failed, onRetry }: { failed: boolean; onRetry: () => Promise<unknown> }) {
  const { t } = useI18n()
  const { lock } = useSession()
  const [trying, setTrying] = useState(false)

  return (
    <div className="app plan-locked">
      <main className="content">
        {!failed || trying ? (
          <section className="card plan-wait" aria-live="polite">
            <span className="spinner spinner-big" aria-hidden />
            <h1 className="plan-wait-title">{t('plan.checking')}</h1>
          </section>
        ) : (
          <>
            <section className="card plan-lock-card" aria-live="polite">
              <CloudOff size={36} aria-hidden />
              <h1 className="screen-title">{t('plan.checkFailedTitle')}</h1>
              <p className="summary-text">{t('plan.checkFailedText')}</p>
            </section>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                setTrying(true)
                await onRetry()
                setTrying(false)
              }}
            >
              <RefreshCw size={20} aria-hidden /> {t('plan.retry')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={lock}>
              <Lock size={20} aria-hidden /> {t('switch.lock')}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
