// The rules for when the app opens, worked out from the plan status alone (no React, no server),
// so they can be tested on their own.
//
//   * An account must always be on a plan: the free trial (once per account) or a paid one.
//     The server starts the trial the first time it is asked, so a phone that has never heard
//     from the server does not know yet and must ask before the app opens.
//   * When the time runs out the app locks and shows the payment screen. Below it, the person
//     may choose to use the app for 5 minutes, once for each time the plan runs out.
//   * The plan they bought most is offered first next time, with the others one tap away.
import type { PlanStatus } from './api'
import type { Period } from './pricing'

export const GRACE_MINUTES = 5
export const GRACE_MS = GRACE_MINUTES * 60_000
const DAY_MS = 24 * 60 * 60 * 1000

export type PlanView = {
  /** The phone knows where the plan stands (from the server, now or earlier). */
  known: boolean
  /** Time has run out (and the account is not free). */
  ended: boolean
  /** Ended, and the 5 minutes are not running: only the payment screen opens. */
  locked: boolean
  /** Ended, but inside the 5 minutes the person chose. */
  inGrace: boolean
  /** The 5 minutes for this end date have already been started (maybe finished). */
  graceUsed: boolean
  /** When the 5 minutes end, if they were started. */
  graceUntil: number | null
  /** Less than a day left (shown as a reminder). */
  endsSoon: boolean
}

/**
 * @param localGraceStart when this phone started the 5 minutes for the current end date, if it did
 *   (kept on the phone so it works offline; the server keeps its own record too).
 */
export function planView(status: PlanStatus | null, now: number, localGraceStart: number | null = null): PlanView {
  if (!status) {
    return { known: false, ended: false, locked: false, inGrace: false, graceUsed: false, graceUntil: null, endsSoon: false }
  }
  const free = !!status.exempt
  const endsAt = new Date(status.expires_at).getTime()
  const ended = !free && endsAt <= now

  const fromServer = status.grace_until ? new Date(status.grace_until).getTime() : null
  const fromPhone = localGraceStart !== null ? localGraceStart + GRACE_MS : null
  // Whichever started first counts: starting again on a second phone gives no new minutes.
  const graceUntil = fromServer !== null && fromPhone !== null ? Math.min(fromServer, fromPhone) : (fromServer ?? fromPhone)

  const inGrace = ended && graceUntil !== null && now < graceUntil
  return {
    known: true,
    ended,
    locked: ended && !inGrace,
    inGrace,
    graceUsed: graceUntil !== null,
    graceUntil,
    endsSoon: !free && !ended && endsAt - now < DAY_MS,
  }
}

/**
 * The plan to offer first: the period they paid for most (else the last one), for the shops they
 * last paid for, never fewer than the shops they own. Null if they have never paid.
 */
export function usualChoice(status: PlanStatus | null, ownedShops: number): { period: Period; shops: number } | null {
  const period = status?.usual_period ?? status?.period ?? null
  if (!period) return null
  return { period, shops: Math.max(1, ownedShops, status?.usual_shops ?? status?.shops ?? 1) }
}

/** "4:05" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
