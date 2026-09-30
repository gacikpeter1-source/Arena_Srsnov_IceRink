/**
 * Captures the browser's `beforeinstallprompt` event (Chrome/Edge on
 * Android and desktop — Firefox and Safari/iOS have no equivalent API, so
 * `canInstall` simply never becomes true there) so a UI control elsewhere
 * in the app can trigger the native "Add to Home Screen" prompt on demand,
 * instead of the browser's own address-bar icon being the only way in.
 *
 * Listeners are attached at module load, not inside a React effect/hook —
 * the event can fire before any component mounts, and it only ever fires
 * once per page load, so missing it there would mean never seeing it.
 * `getSnapshot`/`subscribe` below back a `useSyncExternalStore` hook
 * (see `hooks/usePwaInstall.ts`); `state` is only ever replaced (not
 * mutated) so the snapshot reference stays stable across renders until
 * something actually changes.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaInstallState {
  canInstall: boolean
  installed: boolean
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
}

let state: PwaInstallState = {
  canInstall: false,
  installed: isStandalone()
}

function setState(next: Partial<PwaInstallState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    setState({ canInstall: true })
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    setState({ canInstall: false, installed: true })
  })
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): PwaInstallState {
  return state
}

export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return
  const prompt = deferredPrompt
  deferredPrompt = null
  setState({ canInstall: false })
  await prompt.prompt()
  await prompt.userChoice
}
