import { useSyncExternalStore } from 'react'
import { getSnapshot, subscribe } from '@/lib/pwaInstall'

/** React binding for `lib/pwaInstall.ts` — see that file for the capture logic. */
export function usePwaInstall() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
