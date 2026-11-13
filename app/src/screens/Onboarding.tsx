import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { AccountFailure, joinWithCode, signInOwner } from '../account'
import type { AccountError } from '../account'
import { BusinessFields } from '../components/BusinessFields'
import { PinPad } from '../components/PinPad'
import type { BusinessType } from '../db'
import { createOwnerWithBusiness } from '../directory'
import { useI18n } from '../i18n'
import type { Lang } from '../i18n'
import { useSession } from '../session'
import { backupAvailable } from '../supabase'
import { getDevicePerson, setDevicePerson, syncNow, useSyncState } from '../sync'

type Step = 'welcome' | 'you' | 'pin' | 'confirm' | 'business' | 'signin' | 'join'

const previous: Record<Step, Step | null> = {
  welcome: null,
  you: 'welcome',
  pin: 'you',
  confirm: 'pin',
  business: 'pin',
  signin: 'welcome',
  join: 'welcome',
}

/** First time the app is opened on a phone: the owner sets up themselves and their first business. */
export function Onboarding() {
  const { t, lang, setLang } = useI18n()
  const { login } = useSession()
  const [step, setStep] = useState<Step>('welcome')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState<BusinessType>('kiosk')
  const [saving, setSaving] = useState(false)
  const sync = useSyncState()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [accountError, setAccountError] = useState<AccountError | null>(null)
  const [notice, setNotice] = useState(false)

  // Signing in or joining fetches the shop's records. Once they arrive, the app moves on by
  // itself to "Who is working?", where the person chooses a PIN for this phone.
  const connect = async (e: FormEvent, action: () => Promise<boolean | void>) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setAccountError(null)
    try {
      const hasShop = await action()
      if (hasShop === false) {
        setNotice(true)
        setStep('you')
      }
    } catch (failure) {
      setAccountError(failure instanceof AccountFailure ? failure.key : 'err.other')
    } finally {
      setSaving(false)
    }
  }

  const back = previous[step]

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    if (saving || !businessName.trim()) return
    setSaving(true)
    try {
      const ownerId = await createOwnerWithBusiness({ name, phone, pin, businessName, businessType })
      // Signed in already (an account with no shop yet): this new person is that account's owner.
      if (sync.signedIn && !getDevicePerson()) {
        setDevicePerson(ownerId)
        void syncNow()
      }
      login(ownerId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app gate">
      <header className="topbar">
        {back ? (
          <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={() => setStep(back)}>
            <ArrowLeft size={24} aria-hidden />
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}>
          {({ en: 'Kiswahili', sw: 'English' } satisfies Record<Lang, string>)[lang]}
        </button>
      </header>

      {step === 'welcome' && (
        <div className="gate-body gate-center">
          <img src="/logo.svg" alt="" className="gate-logo" />
          <h1 className="gate-brand">
            Chapa <b>Biz</b>
          </h1>
          <p className="gate-tagline">{t('onboard.tagline')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setStep('you')}>
            {t('onboard.start')}
          </button>
          {backupAvailable && !sync.signedIn && (
            <>
              <button type="button" className="btn btn-quiet gate-second" onClick={() => setStep('join')}>
                {t('account.join')}
              </button>
              <button type="button" className="btn btn-quiet gate-second" onClick={() => setStep('signin')}>
                {t('account.have')}
              </button>
            </>
          )}
        </div>
      )}

      {step === 'signin' && (
        <form className="gate-body" onSubmit={(e) => connect(e, () => signInOwner(email, password))}>
          <h1 className="screen-title">{t('account.signIn')}</h1>
          <label className="field">
            <span>{t('backup.email')}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </label>
          <label className="field">
            <span>{t('backup.password')}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {accountError && (
            <p className="field-error" role="alert">
              {t(accountError)}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {t('account.signIn')}
          </button>
        </form>
      )}

      {step === 'join' && (
        <form className="gate-body" onSubmit={(e) => connect(e, () => joinWithCode(code))}>
          <h1 className="screen-title">{t('account.joinTitle')}</h1>
          <label className="field">
            <span>{t('account.joinHint')}</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
            />
          </label>
          {accountError && (
            <p className="field-error" role="alert">
              {t(accountError)}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || code.trim().length < 6}>
            {t('account.joinBtn')}
          </button>
        </form>
      )}

      {step === 'you' && (
        <form
          className="gate-body"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) setStep('pin')
          }}
        >
          <h1 className="screen-title">{t('onboard.aboutYou')}</h1>
          {notice && <p className="warn-note">{t('account.noShop')}</p>}
          <label className="field">
            <span>{t('onboard.yourName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" autoFocus />
          </label>
          <label className="field">
            <span>{t('onboard.phone')}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              inputMode="tel"
              autoComplete="tel"
              placeholder="07…"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {t('common.next')}
          </button>
        </form>
      )}

      {step === 'pin' && (
        <div className="gate-body gate-center">
          <h1 className="screen-title">{t('onboard.createPin')}</h1>
          <p className={pinError ? 'gate-note gate-error' : 'gate-note'}>
            {pinError ? t('onboard.pinMismatch') : t('onboard.pinHint')}
          </p>
          <PinPad
            key="pin"
            onComplete={(value) => {
              setPin(value)
              setPinError(false)
              setStep('confirm')
              return true
            }}
          />
        </div>
      )}

      {step === 'confirm' && (
        <div className="gate-body gate-center">
          <h1 className="screen-title">{t('onboard.confirmPin')}</h1>
          <p className="gate-note">{t('onboard.pinHint')}</p>
          <PinPad
            key="confirm"
            onComplete={(value) => {
              if (value === pin) {
                setStep('business')
                return true
              }
              setPinError(true)
              setStep('pin')
              return false
            }}
          />
        </div>
      )}

      {step === 'business' && (
        <form className="gate-body" onSubmit={finish}>
          <h1 className="screen-title">{t('onboard.yourBusiness')}</h1>
          <BusinessFields name={businessName} type={businessType} onName={setBusinessName} onType={setBusinessType} />
          <button type="submit" className="btn btn-primary" disabled={saving || !businessName.trim()}>
            {t('onboard.start')}
          </button>
        </form>
      )}
    </div>
  )
}
