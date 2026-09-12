import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeWord } from '../lib/script'

// Minimal typings — lib.dom does not ship the SpeechRecognition constructor.
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error: string }
interface SRInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRCtor = new () => SRInstance

declare global {
  interface Window {
    SpeechRecognition?: SRCtor
    webkitSpeechRecognition?: SRCtor
  }
}

const getCtor = (): SRCtor | undefined =>
  typeof window === 'undefined' ? undefined : window.SpeechRecognition ?? window.webkitSpeechRecognition

export const speechSupported = !!getCtor()

export type SpeechStatus = 'idle' | 'starting' | 'listening' | 'error' | 'unsupported'

interface Options {
  lang?: string
  /** called with the recent stream of normalized spoken words (finals + current interim) */
  onWords: (words: string[]) => void
  /** called when the mic is blocked or missing; recognition stops */
  onError?: (message: string) => void
}

/**
 * Wraps the Web Speech API. `start` must be called from a user gesture
 * (iOS Safari refuses otherwise), so it is imperative rather than effect-driven.
 */
export function useSpeechRecognition({ lang, onWords, onError }: Options) {
  const [liveStatus, setStatus] = useState<Exclude<SpeechStatus, 'unsupported'>>('idle')
  const [error, setError] = useState<string | null>(null)
  /** true for a moment after each recognition result — drives the "hearing you" indicator */
  const [hearing, setHearing] = useState(false)
  /** last few recognised words, for the on-screen transcript */
  const [transcript, setTranscript] = useState('')
  const session = useRef<(() => void) | null>(null)
  const onWordsRef = useRef(onWords)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onWordsRef.current = onWords
    onErrorRef.current = onError
  })

  const stop = useCallback(() => {
    session.current?.()
    session.current = null
    setHearing(false)
    setTranscript('')
    setStatus('idle')
  }, [])

  const start = useCallback(() => {
    if (session.current) return
    const Ctor = getCtor()
    if (!Ctor) return

    let stopped = false
    let restartTimer: number | undefined
    let hearingTimer: number | undefined
    let finals: string[] = []
    let lastFinalIndex = -1
    let gotResult = false
    let networkErrors = 0

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.lang = lang || navigator.language || 'en-US'

    const dispose = () => {
      stopped = true
      window.clearTimeout(restartTimer)
      window.clearTimeout(hearingTimer)
      rec.onstart = rec.onend = rec.onresult = rec.onerror = null
      try { rec.abort() } catch { /* ignore */ }
    }
    const fail = (message: string) => {
      dispose()
      session.current = null
      setError(message)
      setStatus('error')
      onErrorRef.current?.(message)
    }

    rec.onstart = () => {
      lastFinalIndex = -1
      setStatus('listening')
      setError(null)
    }
    rec.onresult = (e) => {
      gotResult = true
      networkErrors = 0
      const interim: string[] = []
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const ws = r[0].transcript.split(/\s+/).map(normalizeWord).filter(Boolean)
        if (r.isFinal) {
          if (i > lastFinalIndex) {
            finals.push(...ws)
            lastFinalIndex = i
          }
        } else {
          interim.push(...ws)
        }
      }
      if (finals.length > 40) finals = finals.slice(-40)
      setHearing(true)
      window.clearTimeout(hearingTimer)
      hearingTimer = window.setTimeout(() => setHearing(false), 1500)
      const stream = [...finals, ...interim]
      setTranscript(stream.slice(-8).join(' '))
      onWordsRef.current(stream)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        fail('Microphone access was blocked. Allow the mic for this site, or use Scroll mode.')
      } else if (e.error === 'audio-capture') {
        fail('No microphone was found.')
      } else if (e.error === 'network') {
        // Chrome-based browsers without Google's speech service (Brave, some Chromium builds)
        // fail this way every time; a one-off blip is retried.
        networkErrors++
        if (!gotResult && networkErrors >= 2) {
          fail('Speech recognition could not reach its service. Use Chrome, Edge or Safari — Brave and Firefox do not support it.')
        }
      } else if (e.error === 'language-not-supported') {
        fail(`Speech recognition does not support the language "${rec.lang}".`)
      }
      // 'no-speech', 'aborted' → onend fires and we restart
    }
    const restart = (delay: number) => {
      restartTimer = window.setTimeout(() => {
        if (stopped) return
        try {
          rec.start()
        } catch {
          // still winding down — try again shortly
          restart(150)
        }
      }, delay)
    }
    rec.onend = () => {
      if (stopped) return
      // Browsers end the session after a pause (phones do it after every utterance);
      // restart at once so the gap is as short as possible.
      restart(0)
    }

    session.current = dispose
    setStatus('starting')
    try {
      rec.start()
    } catch (err) {
      fail(String(err))
    }
  }, [lang])

  // tear down on unmount
  useEffect(() => stop, [stop])

  const status: SpeechStatus = speechSupported ? liveStatus : 'unsupported'
  return { start, stop, status, error, hearing, transcript }
}
