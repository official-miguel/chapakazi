import { demoFlag } from './subscription/demo'

// Chapa Biz moved from its old Vercel address to app.chapabiz.co.ke.

export const NEW_ADDRESS = 'https://app.chapabiz.co.ke'

/** True on the old address (and, in development only, with ?moveDemo=1 to try the notice). */
export function onOldAddress(hostname: string = location.hostname): boolean {
  return hostname.endsWith('.vercel.app') || demoFlag('moveDemo')
}
