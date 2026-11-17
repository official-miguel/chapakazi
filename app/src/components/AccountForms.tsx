import { useState } from 'react'
import type { FormEvent } from 'react'
import { AccountFailure, createOwnerAccount, joinReplacingPhone, signInReplacingPhone } from '../account'
import type { AccountError } from '../account'
import { cleanInviteCode } from '../db'
import { useI18n } from '../i18n'

// The account forms, used by the Backup card (More screen) and by the screen that shows once a
// phone with no account has used its free entries.

/**
 * Create an account for this owner's records, or sign in to one that already exists.
 * Signing in replaces this phone's records with the account's own, so it asks first.
 */
export function OwnerAccountForm({ personId, onDone, autoFocus = true }: { personId: string; onDone?: () => void; autoFocus?: boolean }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'create' | 'signin'>('create')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<AccountError | null>(null)
  const [working, setWorking] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (working) return
    setWorking(true)
    setError(null)
    try {
      if (mode === 'signin') {
        if (!window.confirm(t('backup.signInWarn'))) return
        // Clears this phone's records and reloads the app with the account's own.
        await signInReplacingPhone(email, password)
        return
      }
      await createOwnerAccount(email, password, personId)
      setPassword('')
      onDone?.()
    } catch (failure) {
      setError(failure instanceof AccountFailure ? failure.key : 'err.other')
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <div className="segmented">
        {(['create', 'signin'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? 'segment segment-on' : 'segment'}
            aria-pressed={m === mode}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
          >
            {m === 'create' ? t('backup.create') : t('account.signIn')}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        <label className="field">
          <span>{t('backup.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus={autoFocus}
            required
          />
        </label>
        <label className="field">
          <span>{t('backup.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signin' ? undefined : 8}
            required
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={working}>
          {mode === 'signin' ? t('account.signIn') : t('backup.create')}
        </button>
      </form>
    </>
  )
}

/** Someone with no account joins a shop with the owner's invite code. This phone's records are replaced. */
export function JoinShopForm() {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [error, setError] = useState<AccountError | null>(null)
  const [working, setWorking] = useState(false)

  const join = async (e: FormEvent) => {
    e.preventDefault()
    if (working || code.length < 6) return
    if (!window.confirm(t('account.joinWarn'))) return
    setWorking(true)
    setError(null)
    try {
      // Clears this phone's records and reloads the app with the shop's own.
      await joinReplacingPhone(code)
    } catch (failure) {
      setError(failure instanceof AccountFailure ? failure.key : 'err.other')
    } finally {
      setWorking(false)
    }
  }

  return (
    <form onSubmit={join}>
      <label className="field">
        <span>{t('account.joinHint')}</span>
        <input
          className="code-input"
          value={code}
          onChange={(e) => {
            setCode(cleanInviteCode(e.target.value))
            setError(null)
          }}
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={working || code.length < 6}>
        {t('account.joinBtn')}
      </button>
    </form>
  )
}
