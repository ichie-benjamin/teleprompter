import { useEffect, useState } from 'react'

/** true once the user has not touched / moved / typed for `ms` (only while `active`). */
export function useIdle(ms: number, active: boolean) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!active) return
    let t = 0
    const wake = () => {
      setIdle(false)
      window.clearTimeout(t)
      t = window.setTimeout(() => setIdle(true), ms)
    }
    wake()
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    return () => {
      window.clearTimeout(t)
      events.forEach((e) => window.removeEventListener(e, wake))
    }
  }, [ms, active])
  return active && idle
}
