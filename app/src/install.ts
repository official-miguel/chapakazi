// "Install" support. Chrome fires `beforeinstallprompt` once, often before the page has finished loading,
// so it is caught here (imported first thing in main.tsx) and kept until the Install page asks for it.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let saved: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  saved = e as InstallPromptEvent
  notify()
})
window.addEventListener('appinstalled', () => {
  saved = null
  notify()
})

export function canPromptInstall(): boolean {
  return saved !== null
}

/** Shows the phone's own install box. Returns true if the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!saved) return false
  const ev = saved
  saved = null
  await ev.prompt()
  const { outcome } = await ev.userChoice
  notify()
  return outcome === 'accepted'
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** True when the app is already running installed (from the home screen). */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}
