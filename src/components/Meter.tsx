import { useEffect, useRef, type RefObject } from 'react'

const BARS = 7

/** Tiny VU meter driven straight from a level ref — no React re-renders per frame. */
export function Meter({ levelRef, live, hot }: { levelRef: RefObject<number>; live: boolean; hot: boolean }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    if (!live) {
      bars.current.forEach((b) => b && (b.style.transform = 'scaleY(0.12)'))
      return
    }
    let raf = 0
    let shown = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const target = levelRef.current ?? 0
      // fast attack, slow release
      shown += (target - shown) * (target > shown ? 0.5 : 0.12)
      for (let i = 0; i < BARS; i++) {
        const b = bars.current[i]
        if (!b) continue
        const threshold = i / BARS
        const h = Math.max(0.12, Math.min(1, (shown - threshold) * BARS))
        b.style.transform = `scaleY(${h})`
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [live, levelRef])

  return (
    <span className={`meter${hot ? ' hot' : ''}`} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} ref={(el) => { bars.current[i] = el }} />
      ))}
    </span>
  )
}
