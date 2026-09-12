import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Prompter, type Mode } from './components/Prompter'
import { Editor } from './components/Editor'
import { Meter } from './components/Meter'
import { parseScript, SAMPLE_SCRIPT } from './lib/script'
import { locate } from './lib/match'
import { speechSupported, useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useVoiceActivity } from './hooks/useVoiceActivity'
import { useWakeLock } from './hooks/useWakeLock'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useIdle } from './hooks/useIdle'

const SPOKEN_WINDOW = 6

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'follow', label: 'Follow', hint: 'Tracks the words you say — the highlight and page follow you.' },
  { id: 'auto', label: 'Auto', hint: 'Scrolls at a steady speed. Nothing to do with the mic.' },
  { id: 'voice', label: 'Voice', hint: 'Scrolls while you are talking, pauses the moment you stop.' },
]
const isMode = (v: unknown): v is Mode => v === 'follow' || v === 'auto' || v === 'voice'

// Keys that toggle play/pause. Besides Space this covers Bluetooth shutter remotes
// (HID keyboards): the "Android" button sends Enter, the "iOS" button Volume Up, and
// some clones send a media Play/Pause key.
const TOGGLE_KEYS = new Set([' ', 'Enter', 'MediaPlayPause', 'AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown'])

export default function App() {
  const [text, setText] = useLocalStorage('tp.script', SAMPLE_SCRIPT)
  const [storedMode, setMode] = useLocalStorage<string>('tp.mode.v2', 'voice')
  const mode: Mode = isMode(storedMode) ? storedMode : 'voice'
  const [speed, setSpeed] = useLocalStorage('tp.speed', 60)
  const [fontSize, setFontSize] = useLocalStorage('tp.fontSize', window.innerWidth < 600 ? 32 : 40)
  const [mirror, setMirror] = useLocalStorage('tp.mirror', false)
  const [sensitivity, setSensitivity] = useLocalStorage('tp.sensitivity', 0.6)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [jump, setJump] = useState<{ index: number; id: number } | null>(null)
  const [panel, setPanel] = useState<'none' | 'editor' | 'scenes' | 'settings'>('none')
  const [lastKey, setLastKey] = useState<string | null>(null)

  const script = useMemo(() => parseScript(text), [text])

  // Words that can be matched against speech, and a map word-index → match-position.
  const { norms, matchIndex, posOf } = useMemo(() => {
    const matchable = script.words.filter((w) => w.norm)
    const posOf = new Int32Array(script.words.length)
    let p = -1
    for (const w of script.words) {
      if (w.norm) p++
      posOf[w.index] = Math.max(0, p)
    }
    return { norms: matchable.map((w) => w.norm), matchIndex: matchable.map((w) => w.index), posOf }
  }, [script])

  const updateText = useCallback((next: string) => {
    setText(next)
    setCurrent(0)
  }, [setText])

  const onWords = useCallback(
    (spoken: string[]) => {
      const recent = spoken.slice(-SPOKEN_WINDOW)
      const anchor = posOf[current] ?? 0
      let pos = locate(recent, norms, anchor)
      // Nothing near the current spot: with a solid phrase, search the whole script
      // (covers starting mid-script or after a manual scroll).
      if (pos < 0 && recent.length >= 5) {
        pos = locate(recent, norms, anchor, { behind: norms.length, ahead: norms.length, minScore: 3.8 })
      }
      if (pos >= 0) {
        const idx = matchIndex[pos]
        // Interim results get revised as the recogniser settles; ignore tiny backward
        // steps so the highlight doesn't flicker. Real re-reads further back still work.
        if (idx === current || (idx < current && current - idx <= 3)) return
        setCurrent(idx)
      }
    },
    [current, norms, matchIndex, posOf],
  )

  const onMicError = useCallback(() => setPlaying(false), [])
  const speech = useSpeechRecognition({ onWords, onError: onMicError })
  const vad = useVoiceActivity({ sensitivity, onError: onMicError })
  useWakeLock(playing)
  const dim = useIdle(2500, playing && panel === 'none')

  const { start: startSpeech, stop: stopSpeech } = speech
  const { start: startVad, stop: stopVad } = vad
  const setPlay = useCallback((on: boolean) => {
    // mic access is started synchronously inside the gesture — iOS requires it
    if (on && mode === 'follow') startSpeech()
    else stopSpeech()
    if (on && mode === 'voice') startVad()
    else stopVad()
    setPlaying(on)
  }, [mode, startSpeech, stopSpeech, startVad, stopVad])
  const toggle = useCallback(() => setPlay(!playing), [setPlay, playing])
  const pause = useCallback(() => setPlay(false), [setPlay])
  const switchMode = useCallback((m: Mode) => { pause(); setMode(m) }, [pause, setMode])
  const jumpTo = useCallback((index: number) => setJump({ index, id: Date.now() }), [])

  const prevScene = useCallback(() => {
    const before = script.scenes.filter((sc) => sc.wordIndex < current)
    jumpTo(before.length ? before[before.length - 1].wordIndex : 0)
  }, [script.scenes, current, jumpTo])
  const nextScene = useCallback(() => {
    const after = script.scenes.find((sc) => sc.wordIndex > current)
    if (after) jumpTo(after.wordIndex)
  }, [script.scenes, current, jumpTo])

  // Keyboard / remote: toggle keys above, Esc = pause / close panel, Home = top,
  // PageUp/PageDown or ↑/↓ = previous / next scene (presenter clickers send PageUp/Down).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
      if (e.repeat) return
      setLastKey(e.key === ' ' ? 'Space' : e.key)
      if (TOGGLE_KEYS.has(e.key) || e.code === 'Space') {
        e.preventDefault()
        // a focused button would also fire on keyup — drop focus so the key only toggles once
        if (t instanceof HTMLElement && t.tagName === 'BUTTON') t.blur()
        if (panel === 'none') toggle()
      } else if (e.key === 'Escape') {
        if (panel !== 'none') setPanel('none')
        else pause()
      } else if (e.key === 'Home') {
        jumpTo(0)
      } else if (e.key === 'PageDown' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextScene()
      } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault()
        prevScene()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, toggle, pause, jumpTo, nextScene, prevScene])

  const currentScene = useMemo(() => {
    let s = null
    for (const sc of script.scenes) if (sc.wordIndex <= current) s = sc
    return s
  }, [script.scenes, current])

  const progress = script.words.length ? current / Math.max(1, script.words.length - 1) : 0
  const micError = mode === 'follow' ? speech.error : mode === 'voice' ? vad.error : null
  const togglePanel = (p: typeof panel) => setPanel(panel === p ? 'none' : p)
  const staticMoving = useRef(true)

  return (
    <div className={`app${dim ? ' dim' : ''}${playing ? ' playing' : ''}`}>
      <header className="top">
        <div className="brand">
          <span className={`lamp ${playing ? 'on' : ''}`} />
          <span>Prompter</span>
        </div>
        <div className="top-actions">
          {script.scenes.length > 0 && (
            <button className="chip" onClick={() => togglePanel('scenes')} title="Scenes">
              <span className="mono">{currentScene ? currentScene.label : 'Scenes'}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          )}
          <button className="chip" onClick={() => { pause(); setPanel('editor') }}>Script</button>
          <button className="chip icon" aria-label="Settings" onClick={() => togglePanel('settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="var(--bg)" /><circle cx="15" cy="12" r="2" fill="var(--bg)" /><circle cx="8" cy="17" r="2" fill="var(--bg)" /></svg>
          </button>
        </div>
      </header>

      <div className="progress" aria-hidden><span style={{ transform: `scaleX(${progress})` }} /></div>

      <Prompter
        script={script}
        mode={mode}
        playing={playing}
        current={current}
        speed={speed}
        movingRef={mode === 'voice' ? vad.speakingRef : staticMoving}
        fontSize={fontSize}
        mirror={mirror}
        jump={jump}
        onToggle={toggle}
        onCurrentChange={setCurrent}
        onReachedEnd={pause}
      />

      <div className="dock">
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              className={mode === m.id ? 'on' : ''}
              disabled={m.id === 'follow' && !speechSupported}
              title={m.id === 'follow' && !speechSupported ? 'Speech recognition is not available in this browser' : m.hint}
              onClick={() => switchMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="dock-row">
          <div className="readout">
            {mode === 'follow' && (
              <>
                <div className="readout-line">
                  <span className={`lamp ${speech.status === 'listening' ? (speech.hearing ? 'hot' : 'on') : speech.status === 'starting' ? 'blink' : speech.status === 'error' ? 'err' : ''}`} />
                  <span className="mono label">
                    {speech.status === 'listening' ? (speech.hearing ? 'HEARING YOU' : 'LISTENING')
                      : speech.status === 'starting' ? 'OPENING MIC'
                      : speech.status === 'error' ? 'MIC BLOCKED'
                      : speech.status === 'unsupported' ? 'NO SPEECH API'
                      : 'MIC OFF'}
                  </span>
                </div>
                <div className="transcript">{playing ? (speech.transcript || 'start reading…') : MODES[0].hint}</div>
              </>
            )}
            {mode === 'auto' && (
              <>
                <div className="readout-line">
                  <span className="mono label">SPEED</span>
                  <span className="mono value">{speed}</span>
                </div>
                <input className="speed" type="range" min={10} max={200} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Scroll speed" />
              </>
            )}
            {mode === 'voice' && (
              <>
                <div className="readout-line">
                  <Meter levelRef={vad.levelRef} live={vad.status === 'live'} hot={vad.speaking} />
                  <span className="mono label">
                    {vad.status === 'live' ? (vad.speaking ? 'TALKING · SCROLLING' : 'SILENT · HOLDING')
                      : vad.status === 'starting' ? 'OPENING MIC'
                      : vad.status === 'error' ? 'MIC BLOCKED'
                      : 'MIC OFF'}
                  </span>
                  <span className="mono value">{speed}</span>
                </div>
                <input className="speed" type="range" min={10} max={200} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Scroll speed" />
              </>
            )}
          </div>

          <button className={`play${playing ? ' on' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" /></svg>
            )}
          </button>
        </div>
      </div>

      {micError && <div className="toast">{micError}</div>}

      {panel === 'editor' && (
        <Editor value={text} onChange={updateText} onDone={() => setPanel('none')} />
      )}

      {panel === 'scenes' && (
        <div className="sheet popover" onClick={() => setPanel('none')}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><span className="mono label">SCENES</span><span className="mono value">{script.scenes.length}</span></div>
            <ul className="scenes">
              {script.scenes.map((sc) => (
                <li key={sc.label + sc.wordIndex}>
                  <button className={currentScene === sc ? 'on' : ''} onClick={() => { jumpTo(sc.wordIndex); setPanel('none') }}>
                    <b className="mono">{sc.label}</b>
                    <span>{script.lines[sc.lineIndex].words.slice(0, 9).map((w) => w.text).join(' ')}…</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {panel === 'settings' && (
        <div className="sheet popover" onClick={() => setPanel('none')}>
          <div className="card settings" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><span className="mono label">SETTINGS</span></div>
            <label>
              <span>Text size <em className="mono">{fontSize}px</em></span>
              <input type="range" min={20} max={96} step={2} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
            </label>
            <label>
              <span>Mic sensitivity <em className="mono">{Math.round(sensitivity * 100)}%</em></span>
              <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
              <small>Voice mode. Raise it if the page stalls while you talk; lower it if room noise keeps it moving.</small>
            </label>
            <label className="check">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              <span>Mirror text (beam-splitter glass)</span>
            </label>
            <button className="chip" onClick={() => { jumpTo(0); setPanel('none') }}>Back to top</button>
            <p className="fine">
              <b>Keys</b> Space / Enter — play · Esc — pause · Home — top · PgUp / PgDn — scenes.
              Bluetooth shutter remotes work if they send a key (on Android the volume button is taken by the system).
              Last key received: <code className="mono">{lastKey ?? 'none yet'}</code>
            </p>
            <p className="fine">Everything runs on this device. Nothing is recorded or uploaded.</p>
          </div>
        </div>
      )}
    </div>
  )
}
