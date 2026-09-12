import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { ParsedScript } from '../lib/script'

export type Mode = 'follow' | 'auto' | 'voice'

/** Fraction of the viewport height where the reading line sits. */
export const MARKER = 0.4

interface Props {
  script: ParsedScript
  mode: Mode
  playing: boolean
  current: number
  /** px per second for the timed modes */
  speed: number
  /** voice mode: whether the reader is talking right now */
  movingRef: RefObject<boolean>
  fontSize: number
  mirror: boolean
  /** explicit jump request (scene tap etc.); `id` changes on every request */
  jump: { index: number; id: number } | null
  onToggle: () => void
  onCurrentChange: (index: number) => void
  onReachedEnd: () => void
}

export function Prompter({
  script, mode, playing, current, speed, movingRef, fontSize, mirror, jump,
  onToggle, onCurrentChange, onReachedEnd,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  const wordEls = useRef<(HTMLSpanElement | null)[]>([])
  const speedRef = useRef(speed)
  speedRef.current = speed
  const currentRef = useRef(current)
  currentRef.current = current

  // Cached top offset of each word, for the "which word is at the marker" lookup.
  const tops = useRef<number[] | null>(null)
  const invalidateTops = useCallback(() => { tops.current = null }, [])
  const getTops = () => {
    if (!tops.current) tops.current = wordEls.current.map((el) => el?.offsetTop ?? 0)
    return tops.current
  }
  useLayoutEffect(invalidateTops, [script, fontSize, invalidateTops])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(invalidateTops)
    ro.observe(el)
    return () => ro.disconnect()
  }, [invalidateTops])

  const targetTop = useCallback((index: number) => {
    const el = box.current
    const w = wordEls.current[index]
    if (!el || !w) return null
    return Math.max(0, w.offsetTop + w.offsetHeight / 2 - el.clientHeight * MARKER)
  }, [])

  const scrollToWord = useCallback((index: number, smooth = true) => {
    const top = targetTop(index)
    if (top !== null) box.current?.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  }, [targetTop])

  // Which word sits on the reading line right now (first word of that line).
  const wordAtMarker = useCallback(() => {
    const el = box.current
    const ts = getTops()
    if (!el || !ts.length) return -1
    const y = el.scrollTop + el.clientHeight * MARKER
    let lo = 0, hi = ts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ts[mid] <= y) lo = mid
      else hi = mid - 1
    }
    const lineTop = ts[lo]
    while (lo > 0 && ts[lo - 1] === lineTop) lo--
    return lo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow mode: the highlight leads and the scroll glides after it. One easing loop
  // instead of a native smooth-scroll per recognition event — those restart on every
  // interim result and stutter, especially on phones.
  const userScrollUntil = useRef(0)
  useEffect(() => {
    if (mode !== 'follow' || !playing) return
    const el = box.current
    if (!el) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      raf = requestAnimationFrame(step)
      if (now < userScrollUntil.current) return
      const target = targetTop(currentRef.current)
      if (target === null) return
      const diff = target - el.scrollTop
      if (Math.abs(diff) < 0.5) return
      el.scrollTop += diff * Math.min(1, dt * 7)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [mode, playing, targetTop])

  // Timed modes: the scroll runs on its own clock; the highlight follows the reading line.
  // In voice mode the velocity eases to zero while nobody is talking.
  useEffect(() => {
    if (mode === 'follow' || !playing) return
    const el = box.current
    if (!el) return
    let raf = 0
    let last = performance.now()
    let pos = el.scrollTop
    let velocity = 0
    let lastPick = 0

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const target = mode === 'auto' || movingRef.current ? speedRef.current : 0
      velocity += (target - velocity) * Math.min(1, dt * (target ? 4 : 8))
      // if the reader dragged the page, continue from there
      if (Math.abs(el.scrollTop - pos) > 2) pos = el.scrollTop
      pos += velocity * dt
      const max = el.scrollHeight - el.clientHeight
      if (pos >= max) {
        el.scrollTop = max
        onReachedEnd()
        return
      }
      el.scrollTop = pos
      if (now - lastPick > 100) {
        lastPick = now
        const w = wordAtMarker()
        if (w >= 0 && w !== currentRef.current) onCurrentChange(w)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [mode, playing, movingRef, onCurrentChange, onReachedEnd, wordAtMarker])

  // Manual scrolling: pause following for a moment, and in the timed modes keep the
  // highlight on whatever the reader dragged onto the line.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onUser = () => { userScrollUntil.current = performance.now() + 1200 }
    let t = 0
    const onScroll = () => {
      if (mode === 'follow' && playing) return
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        const w = wordAtMarker()
        if (w >= 0 && w !== currentRef.current) onCurrentChange(w)
      }, 80)
    }
    el.addEventListener('touchstart', onUser, { passive: true })
    el.addEventListener('wheel', onUser, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(t)
      el.removeEventListener('touchstart', onUser)
      el.removeEventListener('wheel', onUser)
      el.removeEventListener('scroll', onScroll)
    }
  }, [mode, playing, wordAtMarker, onCurrentChange])

  // First positioning (mount / new script) is instant and deferred a frame so layout
  // has settled. After that, follow mode also re-centres when paused.
  const settled = useRef(false)
  useEffect(() => {
    if (settled.current) {
      if (mode === 'follow' && !playing) scrollToWord(current)
      return
    }
    if (mode !== 'follow' && playing) return
    const raf = requestAnimationFrame(() => {
      scrollToWord(current, false)
      settled.current = true
    })
    return () => cancelAnimationFrame(raf)
  }, [current, mode, playing, scrollToWord])
  useEffect(() => { settled.current = false }, [script])

  // Explicit jumps work in every mode.
  useEffect(() => {
    if (!jump) return
    onCurrentChange(jump.index)
    scrollToWord(jump.index)
  }, [jump, scrollToWord, onCurrentChange])

  const currentLine = script.words[current]?.line ?? -1
  const highlightWord = mode === 'follow'

  return (
    <div
      ref={box}
      className={`prompter${mirror ? ' mirror' : ''}${playing ? ' playing' : ''}`}
      style={{ '--fs': `${fontSize}px` } as React.CSSProperties}
      onClick={onToggle}
      role="button"
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <div className="gate" aria-hidden />
      <div className="text">
        {script.lines.map((line) => (
          <p
            key={line.index}
            className={
              (line.heading ? 'heading ' : '') +
              (line.index < currentLine ? 'past' : line.index === currentLine ? 'now' : '')
            }
          >
            {line.words.map((w) => (
              <span
                key={w.index}
                ref={(el) => { wordEls.current[w.index] = el }}
                className={
                  highlightWord && w.index === current ? 'w cur'
                  : highlightWord && w.index < current ? 'w past' : 'w'
                }
              >
                {w.text}{' '}
              </span>
            ))}
          </p>
        ))}
        {script.lines.length === 0 && (
          <div className="empty">
            <span className="empty-kicker">No script loaded</span>
            <span>Tap <b>Script</b> to paste your text or open a .txt / .md file.</span>
          </div>
        )}
      </div>
    </div>
  )
}
