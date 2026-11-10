import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PinPad } from '../components/PinPad'
import type { Person } from '../db'
import { inviteCodeMatches, setFirstPin } from '../directory'
import { useI18n } from '../i18n'
import { verifyPin } from '../pin'
import { useSession, viewsFor } from '../session'

const MAX_TRIES = 5
const WAIT_MS = 30_000
const triesKey = (personId: string) => `ck.tries.${personId}`

type Tries = { count: number; blockedUntil: number }

function readTries(personId: string): Tries {
  try {
    const raw = localStorage.getItem(triesKey(personId))
    if (raw) return JSON.parse(raw) as Tries
  } catch {
    // fall through
  }
  return { count: 0, blockedUntil: 0 }
}

function saveTries(personId: string, tries: Tries | null) {
  try {
    if (tries) localStorage.setItem(triesKey(personId), JSON.stringify(tries))
    else localStorage.removeItem(triesKey(personId))
  } catch {
    // Storage blocked; the wait then only lasts while the screen stays open.
  }
}

/** Shown whenever nobody is signed in: pick your name, then enter your PIN. */
export function LockScreen() {
  const { t } = useI18n()
  const { dir } = useSession()
  const [chosen, setChosen] = useState<Person | null>(null)

  const people = dir.people
    .map((person) => ({ person, views: viewsFor(person.id, dir) }))
    .filter((p) => p.views.length > 0)
    .sort((a, b) => a.person.createdAt - b.person.createdAt)

  if (chosen) {
    // Read the person fresh so a PIN saved a moment ago is seen.
    const person = dir.people.find((p) => p.id === chosen.id)
    if (person) return <SignIn person={person} onBack={() => setChosen(null)} />
  }

  return (
    <div className="app gate">
      <header className="topbar">
        <span className="brand">
          <img src="/logo.svg" alt="" />
          Chapa <b>Kazi</b>
        </span>
      </header>
      <div className="gate-body">
        <h1 className="screen-title">{t('lock.title')}</h1>
        <div className="list">
          {people.map(({ person, views }) => {
            const isOwner = views.some((v) => v.role === 'admin')
            const shop = dir.businesses.find((b) => b.id === views[0].businessId)?.name
            return (
              <button key={person.id} type="button" className="list-row" onClick={() => setChosen(person)}>
                <span className="avatar" aria-hidden>
                  {person.name.charAt(0).toUpperCase()}
                </span>
                <span className="list-main">
                  <span className="list-title">{person.name}</span>
                  <span className="list-sub">
                    {person.pinHash
                      ? `${isOwner ? t('role.owner') : t('role.worker')}${!isOwner && shop ? ` · ${shop}` : ''}`
                      : t('lock.newWorker')}
                  </span>
                </span>
                <ChevronRight size={22} aria-hidden />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SignIn({ person, onBack }: { person: Person; onBack: () => void }) {
  const { t } = useI18n()
  const { login } = useSession()
  const needsFirstPin = !person.pinHash

  // New worker: invite code, then choose a PIN twice.
  const [code, setCode] = useState('')
  const [codeOk, setCodeOk] = useState(false)
  const [codeError, setCodeError] = useState(false)
  const [firstPin, setFirstPinValue] = useState('')
  const [mismatch, setMismatch] = useState(false)

  // Returning person: PIN with a pause after too many wrong tries.
  const [tries, setTries] = useState<Tries>(() => readTries(person.id))
  const [now, setNow] = useState(() => Date.now())
  const waitSeconds = Math.max(0, Math.ceil((tries.blockedUntil - now) / 1000))
  const [wrong, setWrong] = useState(false)

  useEffect(() => {
    if (waitSeconds === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [waitSeconds])

  const checkPin = async (pin: string) => {
    if (!person.pinSalt || !person.pinHash) return false
    if (await verifyPin(pin, person.pinSalt, person.pinHash)) {
      saveTries(person.id, null)
      login(person.id)
      return true
    }
    const count = tries.count + 1
    const next: Tries =
      count >= MAX_TRIES ? { count: 0, blockedUntil: Date.now() + WAIT_MS } : { count, blockedUntil: 0 }
    saveTries(person.id, next)
    setTries(next)
    setNow(Date.now())
    setWrong(true)
    return false
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await inviteCodeMatches(person.id, code)
    setCodeOk(ok)
    setCodeError(!ok)
  }

  let body
  if (!needsFirstPin) {
    body = (
      <>
        <p className={waitSeconds > 0 || wrong ? 'gate-note gate-error' : 'gate-note'} role="status">
          {waitSeconds > 0
            ? t('lock.tooMany', { s: waitSeconds })
            : wrong
              ? t('lock.wrongPin')
              : t('lock.enterPin')}
        </p>
        <PinPad onComplete={checkPin} disabled={waitSeconds > 0} />
      </>
    )
  } else if (!codeOk) {
    body = (
      <form className="gate-form" onSubmit={submitCode}>
        <label className="field">
          <span>{t('lock.enterCode')}</span>
          <input
            className="code-input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setCodeError(false)
            }}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus
          />
        </label>
        {codeError && (
          <p className="gate-note gate-error" role="alert">
            {t('lock.wrongCode')}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={code.trim().length < 6}>
          {t('common.next')}
        </button>
      </form>
    )
  } else if (!firstPin) {
    body = (
      <>
        <p className={mismatch ? 'gate-note gate-error' : 'gate-note'}>
          {mismatch ? t('onboard.pinMismatch') : t('onboard.createPin')}
        </p>
        <PinPad
          key="first"
          onComplete={(pin) => {
            setFirstPinValue(pin)
            setMismatch(false)
            return true
          }}
        />
      </>
    )
  } else {
    body = (
      <>
        <p className="gate-note">{t('onboard.confirmPin')}</p>
        <PinPad
          key="again"
          onComplete={async (pin) => {
            if (pin !== firstPin) {
              setFirstPinValue('')
              setMismatch(true)
              return false
            }
            if (await setFirstPin(person.id, code, pin)) login(person.id)
            return true
          }}
        />
      </>
    )
  }

  return (
    <div className="app gate">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={onBack}>
          <ArrowLeft size={24} aria-hidden />
        </button>
        <span />
      </header>
      <div className="gate-body gate-center">
        <span className="avatar avatar-lg" aria-hidden>
          {person.name.charAt(0).toUpperCase()}
        </span>
        <h1 className="gate-name">{person.name}</h1>
        {body}
      </div>
    </div>
  )
}
