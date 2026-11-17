import { Check, Clock, Lock, Minus, Plus, RotateCcw, Smartphone, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '../i18n'
import type { WordKey } from '../i18n'
import { useSession } from '../session'
import { beginGrace, choosePlan, PayError, planApi, refreshPlan, usePlan } from '../subscription/api'
import { GRACE_MINUTES, usualChoice } from '../subscription/gate'
import type { PayStatus, Quote } from '../subscription/api'
import { formatKes, periodTotal, PERIODS, planName, savingVsDaily } from '../subscription/pricing'
import type { Period, PlanName, PriceRow } from '../subscription/pricing'

const planWord: Record<PlanName, WordKey> = {
  starter: 'plan.starter',
  growth: 'plan.growth',
  business: 'plan.business',
  enterprise: 'plan.enterprise',
}
const periodWord: Record<Period, WordKey> = { daily: 'plan.daily', weekly: 'plan.weekly', monthly: 'plan.monthly' }
const perWord: Record<Period, WordKey> = { daily: 'plan.perDay', weekly: 'plan.perWeek', monthly: 'plan.perMonth' }

/** Plain words for every way a payment can fail to start. */
const startError = (code: string): WordKey =>
  (
    ({
      bad_phone: 'plan.errPhone',
      busy: 'plan.errBusy',
      not_set_up: 'plan.errNotSetUp',
      mpesa_refused: 'plan.errRefused',
      mpesa_unreachable: 'plan.errUnreachable',
      offline: 'plan.errOffline',
      no_account: 'plan.errNoAccount',
      fewer_than_owned: 'plan.errFewer',
      exempt: 'plan.freeText',
    }) as Record<string, WordKey>
  )[code] ?? 'plan.errOther'

const resultTitle: Record<Exclude<PayStatus['status'], 'pending' | 'success'>, WordKey> = {
  cancelled: 'plan.cancelled',
  timeout: 'plan.timeout',
  failed: 'plan.failed',
  underpaid: 'plan.underpaid',
}

/** A Kenyan mobile number the way people type it: 07..., 01..., +254..., 254... */
const phoneOk = (p: string) => /^(?:\+?254|0)?[17]\d{8}$/.test(p.replace(/[\s-]/g, ''))

// The M-Pesa number last used to pay, so it need not be typed every time.
const PAY_PHONE_KEY = 'ck.payPhone'
function lastPayPhone(): string {
  try {
    return localStorage.getItem(PAY_PHONE_KEY) ?? ''
  } catch {
    return ''
  }
}
function rememberPayPhone(phone: string) {
  try {
    localStorage.setItem(PAY_PHONE_KEY, phone.trim())
  } catch {
    // Not remembered; it is typed again next time.
  }
}

type Step = 'shops' | 'period' | 'pay' | 'waiting' | 'done'

/**
 * Below the payment screen once the plan has ended: the choice to use the app for 5 minutes,
 * once for each time the plan ends. Paying is always shown first.
 */
function GraceOffer({ used, businessId }: { used: boolean; businessId: string | null }) {
  const { t } = useI18n()
  const [starting, setStarting] = useState(false)
  if (used) return <p className="card-note plan-grace-used">{t('grace.used', { n: GRACE_MINUTES })}</p>
  return (
    <section className="card plan-grace">
      <h2 className="card-title">{t('grace.title')}</h2>
      <p className="card-note">{t('grace.text', { n: GRACE_MINUTES })}</p>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={starting}
        onClick={async () => {
          setStarting(true)
          await beginGrace(businessId)
          setStarting(false)
        }}
      >
        <Clock size={20} aria-hidden /> {t('grace.btn', { n: GRACE_MINUTES })}
      </button>
    </section>
  )
}

/**
 * Choose shops, choose a period, pay by M-Pesa. `locked` is the full-screen version shown when
 * the plan has run out: then nothing else in the app opens.
 */
export function PlanScreen({ locked = false }: { locked?: boolean }) {
  const { t, lang } = useI18n()
  const { dir, person, views, business, ownsShop, lock } = useSession()
  const isOwner = views.some((v) => v.role === 'admin')
  const planFor = isOwner ? null : (business?.id ?? null)
  const { status, graceUsed, choice } = usePlan(planFor, !locked)

  const ownedShops = Math.max(1, dir.businesses.filter((b) => ownsShop(b.id)).length, status?.owned_shops ?? 0)
  const [prices, setPrices] = useState<PriceRow[] | null>(null)
  const [loadError, setLoadError] = useState<WordKey | null>(null)
  const [step, setStep] = useState<Step>('shops')
  // The plan they usually buy (or chose during the trial) is offered first; "choose another"
  // opens all of them.
  const usual = usualChoice(status, ownedShops, choice)
  // During the free trial, choosing a plan only saves it: nothing is paid until the trial ends.
  const trialRunning = !locked && !!status?.in_trial && status.active
  const [choosing, setChoosing] = useState(false)
  const [shops, setShops] = useState(() => usual?.shops ?? Math.max(ownedShops, status?.shops ?? 1))
  const [period, setPeriod] = useState<Period | null>(usual?.period ?? 'monthly')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [phone, setPhone] = useState(() => lastPayPhone() || person?.phone || '')
  const [error, setError] = useState<WordKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [payment, setPayment] = useState<PayStatus | null>(null)
  const poll = useRef<number | null>(null)

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'sw' ? 'sw-KE' : 'en-KE', { day: 'numeric', month: 'long', year: 'numeric' })

  useEffect(() => {
    if (!isOwner) return
    planApi
      .prices()
      .then((rows) => setPrices(PERIODS.map((p) => rows.find((r) => r.period === p)!).filter(Boolean)))
      .catch((e) => setLoadError(startError(e instanceof PayError ? e.code : 'other')))
  }, [isOwner])

  useEffect(() => () => {
    if (poll.current) window.clearTimeout(poll.current)
  }, [])

  // While time is paid for, more shops can be added on their own (pay only for the days left).
  const paidActive = !!status && status.active && !status.in_trial
  const canAddOnly = paidActive && shops > (status?.shops ?? 1)

  const cards = useMemo(
    () =>
      prices?.map((p) => ({
        period: p.period,
        total: periodTotal(p, shops),
        saving: savingVsDaily(prices, p.period, shops),
      })) ?? [],
    [prices, shops],
  )

  // ---- worker: nothing to choose ----------------------------------------------------------
  if (!isOwner) {
    return (
      <div className={locked ? 'app plan-locked' : undefined}>
        <div className={locked ? 'content' : undefined}>
          <section className="card plan-lock-card">
            <Lock size={36} aria-hidden />
            <h1 className="screen-title">{t('plan.workerLockedTitle')}</h1>
            <p className="summary-text">{t('plan.workerLockedText')}</p>
          </section>
          {locked && <GraceOffer used={graceUsed} businessId={planFor} />}
          {locked && (
            <button type="button" className="btn btn-quiet" onClick={lock}>
              <Lock size={20} aria-hidden /> {t('switch.lock')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // Chapa Biz switched "must pay" off for this owner: nothing to choose or pay.
  if (status?.exempt) {
    return (
      <>
        <h1 className="screen-title">{t('plan.title')}</h1>
        <section className="card plan-now">
          <p className="plan-now-label">{t('plan.current')}</p>
          <p className="plan-now-name">{t('plan.free')}</p>
          <p className="plan-now-date">{t('plan.freeText')}</p>
        </section>
      </>
    )
  }

  /** In the trial: save the plan for after it. Nothing is charged. */
  const saveChoice = async (chosen: Period) => {
    setBusy(true)
    setError(null)
    const problem = await choosePlan(chosen, shops)
    setBusy(false)
    if (problem) {
      setError(startError(problem))
      return
    }
    setPeriod(chosen)
    setChoosing(false)
    setStep('shops')
  }

  const openPay = async (chosen: Period | null, count = shops) => {
    setPeriod(chosen)
    setShops(count)
    setStep('pay')
    setQuote(null)
    setError(null)
    try {
      const q = await planApi.quote(chosen, count)
      if (!q.ok) setError(startError(q.error ?? 'other'))
      setQuote(q)
    } catch (e) {
      setError(startError(e instanceof PayError ? e.code : 'other'))
    }
  }

  const watch = (paymentId: string, tries = 0) => {
    poll.current = window.setTimeout(async () => {
      try {
        const s = await planApi.check(paymentId)
        setPayment(s)
        if (s.status === 'pending' && tries < 60) return watch(paymentId, tries + 1)
        if (s.status === 'pending') setPayment({ ...s, status: 'timeout' })
        setStep('done')
        // On the locked screen the app opens only when they tap, so they see the receipt first.
        if (s.status === 'success' && !locked) void refreshPlan(null)
      } catch {
        // No internet for a moment: keep asking.
        if (tries < 60) watch(paymentId, tries + 1)
        else {
          setPayment((p) => (p ? { ...p, status: 'timeout' } : p))
          setStep('done')
        }
      }
    }, 3000)
  }

  const pay = async (e: FormEvent) => {
    e.preventDefault()
    if (!phoneOk(phone)) {
      setError('plan.errPhone')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const started = await planApi.start(period, shops, phone)
      rememberPayPhone(phone)
      setPayment({ payment_id: started.payment_id, status: 'pending', amount: started.amount, receipt: null, result_code: null, expires_at: null })
      setStep('waiting')
      watch(started.payment_id)
    } catch (err) {
      setError(startError(err instanceof PayError ? err.code : 'other'))
    } finally {
      setBusy(false)
    }
  }

  const stepNo = step === 'shops' ? 1 : step === 'period' ? 2 : 3
  const showUsual = step === 'shops' && !choosing && usual !== null
  const usualRow = usual ? prices?.find((p) => p.period === usual.period) : undefined
  const usualPrice = usual && usualRow ? periodTotal(usualRow, usual.shops) : null

  const body = (
    <>
      <h1 className="screen-title">{t(locked ? 'plan.lockedTitle' : 'plan.title')}</h1>

      {/* Where they stand right now. */}
      {status && (
        <section className={status.active ? 'card plan-now' : 'card plan-now plan-now-over'}>
          <p className="plan-now-label">{t('plan.current')}</p>
          <p className="plan-now-name">
            {status.in_trial ? t('plan.trial') : t(planWord[status.plan ?? 'starter'])}
            {!status.in_trial && <span className="plan-now-shops"> · {t('plan.shopsN', { n: status.shops ?? 1 })}</span>}
          </p>
          <p className="plan-now-date">
            {t(status.active ? 'plan.until' : 'plan.endedOn', { date: date(status.expires_at) })}
          </p>
          {status.shops_after && status.shops_change_at && (
            <p className="card-note">{t('plan.dropLater', { n: status.shops_after, date: date(status.shops_change_at) })}</p>
          )}
        </section>
      )}
      {locked && <p className="warn-note plan-warn">{t('plan.lockedText')}</p>}

      {loadError && <p className="field-error" role="alert">{t(loadError)}</p>}

      {/* The plan they usually buy, ready to pay in one tap. */}
      {showUsual && usual && (
        <section className="card plan-usual">
          <p className="plan-now-label">
            {t(trialRunning ? 'plan.afterTrial' : usual.source === 'chosen' ? 'plan.chosen' : 'plan.usual')}
          </p>
          <p className="plan-now-name">
            {t(periodWord[usual.period])}
            <span className="plan-now-shops"> · {t('plan.shopsN', { n: usual.shops })}</span>
          </p>
          {usualPrice !== null && <p className="plan-usual-price">{formatKes(usualPrice)} <span className="period-per">{t(perWord[usual.period])}</span></p>}
          {trialRunning && status ? (
            <p className="card-note plan-free-note">{t('plan.nothingNow', { date: date(status.expires_at) })}</p>
          ) : (
            <button type="button" className="btn btn-primary btn-pay" disabled={!prices} onClick={() => openPay(usual.period, usual.shops)}>
              <Smartphone size={22} aria-hidden />
              {usualPrice !== null ? t('plan.payBtn', { amount: formatKes(usualPrice) }) : t('plan.working')}
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => setChoosing(true)}>
            {t(trialRunning ? 'plan.changePlan' : 'plan.otherPlans')}
          </button>
        </section>
      )}

      {trialRunning && !showUsual && status && (
        <p className="card-note plan-free-note">{t('plan.trialChoose', { date: date(status.expires_at) })}</p>
      )}

      {!showUsual && !trialRunning && step !== 'waiting' && step !== 'done' && (
        <p className="plan-steps" aria-label={t('plan.stepOf', { n: stepNo })}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= stepNo ? 'plan-dot plan-dot-on' : 'plan-dot'} />
          ))}
          <span>{t('plan.stepOf', { n: stepNo })}</span>
        </p>
      )}

      {/* Step 1: how many shops */}
      {step === 'shops' && !showUsual && (
        <section className="card">
          <h2 className="card-title">{t('plan.howManyShops')}</h2>
          <div className="stepper">
            <button type="button" className="stepper-btn" aria-label={t('plan.fewer')} disabled={shops <= ownedShops} onClick={() => setShops((n) => n - 1)}>
              <Minus size={28} aria-hidden />
            </button>
            <output className="stepper-value" aria-live="polite">
              {shops}
            </output>
            <button type="button" className="stepper-btn" aria-label={t('plan.more')} disabled={shops >= 50} onClick={() => setShops((n) => n + 1)}>
              <Plus size={28} aria-hidden />
            </button>
          </div>
          <p className="plan-badge-row">
            <span className="plan-badge">{t(planWord[planName(shops)])}</span>
          </p>
          {ownedShops > 1 && <p className="card-note">{t('plan.minShops', { n: ownedShops })}</p>}
          <button type="button" className="btn btn-primary" disabled={!prices} onClick={() => setStep('period')}>
            {t('common.next')}
          </button>
          {usual && (
            <button type="button" className="btn btn-quiet" onClick={() => setChoosing(false)}>
              {t('common.back')}
            </button>
          )}
        </section>
      )}

      {/* Step 2: day, week or month */}
      {step === 'period' && (
        <>
          <h2 className="card-title plan-h2">{t(trialRunning ? 'plan.howLongTrial' : 'plan.howLong', { n: shops })}</h2>
          {error && trialRunning && <p className="field-error" role="alert">{t(error)}</p>}
          <div className="period-cards">
            {cards.map((c) => (
              <button
                key={c.period}
                type="button"
                className={c.period === (usual?.period ?? 'monthly') ? 'period-card period-best' : 'period-card'}
                disabled={busy}
                onClick={() => (trialRunning ? saveChoice(c.period) : openPay(c.period))}
              >
                {c.period === usual?.period ? (
                  <span className="period-ribbon">{t(usual.source === 'chosen' ? 'plan.chosenShort' : 'plan.usualShort')}</span>
                ) : (
                  !usual && c.period === 'monthly' && <span className="period-ribbon">{t('plan.bestValue')}</span>
                )}
                <span className="period-name">{t(periodWord[c.period])}</span>
                <span className="period-price">{formatKes(c.total)}</span>
                <span className="period-per">{t(perWord[c.period])}</span>
                {c.saving > 0 && <span className="period-save">{t('plan.save', { amount: formatKes(c.saving) })}</span>}
              </button>
            ))}
          </div>
          {canAddOnly && (
            <button type="button" className="btn btn-quiet" onClick={() => openPay(null)}>
              {t('plan.addOnly', { n: shops - (status?.shops ?? 1) })}
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => setStep('shops')}>
            {t('common.back')}
          </button>
        </>
      )}

      {/* Step 3: check and pay */}
      {step === 'pay' && (
        <form className="card" onSubmit={pay}>
          <h2 className="card-title">{t('plan.summary')}</h2>
          {!quote && !error && <p className="plan-loading"><span className="spinner" aria-hidden /> {t('plan.working')}</p>}
          {quote?.ok && (
            <table className="compare plan-summary">
              <tbody>
                <tr><th scope="row">{t('plan.planLabel')}</th><td>{t(planWord[quote.plan])}</td></tr>
                <tr><th scope="row">{t('plan.shopsLabel')}</th><td>{quote.shops}</td></tr>
                <tr><th scope="row">{t('plan.periodLabel')}</th><td>{quote.period ? t(periodWord[quote.period]) : t('plan.addOnlyShort')}</td></tr>
                {quote.extra_now > 0 && quote.renewal > 0 && (
                  <tr><th scope="row">{t('plan.extraNow')}</th><td>{formatKes(quote.extra_now)}</td></tr>
                )}
                <tr className="plan-total"><th scope="row">{t('plan.total')}</th><td>{formatKes(quote.total)}</td></tr>
                <tr><th scope="row">{t('plan.newEnd')}</th><td>{date(quote.new_expires_at)}</td></tr>
              </tbody>
            </table>
          )}
          {quote?.ok && quote.extra_now > 0 && <p className="card-note">{t('plan.extraNote')}</p>}
          {quote?.ok && shops < (status?.shops ?? 0) && paidActive && <p className="card-note">{t('plan.fewerLater')}</p>}

          <label className="field plan-phone">
            <span>{t('plan.phone')}</span>
            <input value={phone} onChange={(e) => { setPhone(e.target.value); setError(null) }} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" />
          </label>

          {error && <p className="field-error" role="alert">{t(error)}</p>}

          <button type="submit" className="btn btn-primary btn-pay" disabled={!quote?.ok || busy}>
            <Smartphone size={22} aria-hidden />
            {quote?.ok ? t('plan.payBtn', { amount: formatKes(quote.total) }) : t('plan.working')}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setStep('period')}>
            {t('common.back')}
          </button>
        </form>
      )}

      {/* Waiting for the PIN */}
      {step === 'waiting' && payment && (
        <section className="card plan-wait" aria-live="polite">
          <span className="spinner spinner-big" aria-hidden />
          <h2 className="plan-wait-title">{t('plan.checkPhone')}</h2>
          <p className="summary-text">{t('plan.checkPhoneText', { amount: formatKes(payment.amount) })}</p>
        </section>
      )}

      {/* The answer */}
      {step === 'done' && payment && (
        payment.status === 'success' ? (
          <section className="card plan-result plan-ok" aria-live="polite">
            <span className="plan-result-icon"><Check size={36} aria-hidden /></span>
            <h2 className="plan-wait-title">{t('plan.success')}</h2>
            <p className="summary-text">
              {t('plan.successText', { amount: formatKes(payment.amount), date: payment.expires_at ? date(payment.expires_at) : '' })}
            </p>
            {payment.receipt && <p className="card-note">{t('plan.receipt', { code: payment.receipt })}</p>}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (locked) void refreshPlan(null)
                setStep('shops')
                setChoosing(false)
                setPayment(null)
              }}
            >
              {t(locked ? 'plan.openApp' : 'plan.doneBtn')}
            </button>
          </section>
        ) : (
          <section className="card plan-result plan-bad" aria-live="polite">
            <span className="plan-result-icon"><X size={36} aria-hidden /></span>
            <h2 className="plan-wait-title">{t(resultTitle[payment.status as keyof typeof resultTitle] ?? 'plan.failed')}</h2>
            <p className="summary-text">{t(payment.status === 'timeout' ? 'plan.timeoutText' : payment.status === 'underpaid' ? 'plan.underpaidText' : 'plan.failedText')}</p>
            <button type="button" className="btn btn-primary" onClick={() => { setStep('pay'); setPayment(null) }}>
              <RotateCcw size={20} aria-hidden /> {t('plan.retry')}
            </button>
          </section>
        )
      )}

      {locked && step !== 'waiting' && step !== 'done' && <GraceOffer used={graceUsed} businessId={planFor} />}

      {locked && (
        <button type="button" className="btn btn-quiet" onClick={lock}>
          <Lock size={20} aria-hidden /> {t('switch.lock')}
        </button>
      )}
    </>
  )

  // The locked version has no tabs or menu around it: paying is the only way forward.
  return locked ? (
    <div className="app plan-locked">
      <main className="content">{body}</main>
    </div>
  ) : (
    body
  )
}
