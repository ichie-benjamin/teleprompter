import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ParsedScript } from '../lib/script'

export type Mode = 'voice' | 'scroll'

/** Fraction of the viewport height where the reading line sits. */
const MARKER = 0.4

interface Props {
  script: ParsedScript
  mode: Mode
  playing: boolean
  current: number
  /** px per second in scroll mode */
  speed: number
  fontSize: number
  mirror: boolean
  /** explicit jump request (scene tap etc.); `id` changes on every request */
  jump: { index: number; id: number } | null
  onToggle: () => void
  onCurrentChange: (index: number) => void
  onReachedEnd: () => void
}

export function Prompter({
  script, mode, playing, current, speed, fontSize, mirror, jump,
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

  const scrollToWord = useCallback((index: number, smooth = true) => {
    const el = box.current
    const w = wordEls.current[index]
    if (!el || !w) return
    const top = w.offsetTop + w.offsetHeight / 2 - el.clientHeight * MARKER
    el.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Voice mode (and any paused state): the highlight leads, the scroll follows.
  // The first positioning (mount / new script) is instant and deferred a frame
  // so layout has settled.
  const settled = useRef(false)
  useEffect(() => {
    if (settled.current) {
      // scroll mode moves on its own clock (and via explicit jumps) — only voice follows here
      if (mode === 'voice') scrollToWord(current)
      return
    }
    if (mode === 'scroll' && playing) return
    const raf = requestAnimationFrame(() => {
      scrollToWord(current, false)
      settled.current = true
    })
    return () => cancelAnimationFrame(raf)
  }, [current, mode, playing, scrollToWord])
  useEffect(() => { settled.current = false }, [script])

  // Explicit jumps work in both modes.
  useEffect(() => {
    if (!jump) return
    onCurrentChange(jump.index)
    scrollToWord(jump.index)
  }, [jump, scrollToWord, onCurrentChange])

  // Scroll mode: time drives the scroll, the highlight follows the marker line.
  useEffect(() => {
    if (mode !== 'scroll' || !playing) return
    const el = box.current
    if (!el) return
    let raf = 0
    let last = performance.now()
    let pos = el.scrollTop
    let lastPick = 0

    const pickWord = () => {
      const ts = getTops()
      if (!ts.length) return
      const y = el.scrollTop + el.clientHeight * MARKER
      // last word whose top is above the marker
      let lo = 0, hi = ts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (ts[mid] <= y) lo = mid
        else hi = mid - 1
      }
      // snap to the first word of that line
      const lineTop = ts[lo]
      while (lo > 0 && ts[lo - 1] === lineTop) lo--
      if (lo !== currentRef.current) onCurrentChange(lo)
    }

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // if the reader dragged the page, follow them
      if (Math.abs(el.scrollTop - pos) > 2) pos = el.scrollTop
      pos += speedRef.current * dt
      const max = el.scrollHeight - el.clientHeight
      if (pos >= max) {
        el.scrollTop = max
        onReachedEnd()
        return
      }
      el.scrollTop = pos
      if (now - lastPick > 100) {
        lastPick = now
        pickWord()
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, playing, onCurrentChange, onReachedEnd])

  const currentLine = script.words[current]?.line ?? -1
  const highlightWord = mode === 'voice'

  return (
    <div
      ref={box}
      className={`prompter${mirror ? ' mirror' : ''}${playing ? ' playing' : ''}`}
      style={{ '--fs': `${fontSize}px` } as React.CSSProperties}
      onClick={onToggle}
      role="button"
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <div className="marker" aria-hidden />
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
                  : w.index < current ? 'w past' : 'w'
                }
              >
                {w.text}{' '}
              </span>
            ))}
          </p>
        ))}
        {script.lines.length === 0 && (
          <p className="empty">No script yet. Tap “Script” to paste or load one.</p>
        )}
      </div>
    </div>
  )
}
