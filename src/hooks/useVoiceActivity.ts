import { useCallback, useEffect, useRef, useState } from 'react'

export type VadStatus = 'idle' | 'starting' | 'live' | 'error'

interface Options {
  /** 0 (needs a loud, close voice) … 1 (very sensitive) */
  sensitivity: number
  /** ms of silence before `speaking` drops */
  hangover?: number
  /** called when the mic could not be opened */
  onError?: (message: string) => void
}

/**
 * Microphone level detection with an adaptive noise floor. Nothing is
 * recognised or uploaded — it only answers "is someone talking right now?".
 * `start` must be called from a user gesture (AudioContext rules).
 */
export function useVoiceActivity({ sensitivity, hangover = 700, onError }: Options) {
  const [status, setStatus] = useState<VadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  /** 0..1 input level, updated ~20×/s without re-rendering — read it from a rAF loop */
  const levelRef = useRef(0)
  const speakingRef = useRef(false)
  const sensRef = useRef(sensitivity)
  useEffect(() => { sensRef.current = sensitivity }, [sensitivity])
  const session = useRef<(() => void) | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])
  const fail = useCallback((message: string) => {
    setError(message)
    setStatus('error')
    onErrorRef.current?.(message)
  }, [])

  const stop = useCallback(() => {
    session.current?.()
    session.current = null
    levelRef.current = 0
    speakingRef.current = false
    setSpeaking(false)
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    if (session.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      fail('This browser cannot access the microphone.')
      return
    }
    setStatus('starting')
    setError(null)
    let stream: MediaStream
    let ctx: AudioContext
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      ctx = new AudioContext()
      await ctx.resume()
    } catch (err) {
      const name = (err as DOMException)?.name
      fail(
        name === 'NotAllowedError' ? 'Microphone access was blocked. Allow the mic for this site.'
        : name === 'NotFoundError' ? 'No microphone was found.'
        : `Could not open the microphone (${name ?? String(err)}).`,
      )
      return
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.4
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    let floor = -60 // dB — adaptive background level
    let lastVoice = 0
    let wasSpeaking = false
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-8)
      // floor drops instantly, rises slowly so a long sentence doesn't become "background"
      floor = db < floor ? db : Math.min(floor + 0.08, -20)
      const margin = 5 + (1 - sensRef.current) * 15 // 5 dB (sensitive) … 20 dB (strict)
      const now = performance.now()
      if (db > floor + margin) lastVoice = now
      const isSpeaking = now - lastVoice < hangover
      levelRef.current = Math.max(0, Math.min(1, (db + 60) / 55))
      speakingRef.current = isSpeaking
      if (isSpeaking !== wasSpeaking) {
        wasSpeaking = isSpeaking
        setSpeaking(isSpeaking)
      }
    }
    // setInterval rather than rAF: keeps working when the screen is dimmed
    const timer = window.setInterval(tick, 50)

    session.current = () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
    }
    setStatus('live')
  }, [hangover, fail])

  useEffect(() => stop, [stop])

  return { start, stop, status, error, speaking, speakingRef, levelRef }
}
