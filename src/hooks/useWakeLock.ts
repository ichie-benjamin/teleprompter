import { useEffect } from 'react'

/** Keeps the screen on while `active` (phones dim otherwise mid-read). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let released = false
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch { /* not allowed (e.g. low battery) — ignore */ }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !released) request()
    }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}
