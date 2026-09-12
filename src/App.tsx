import { useCallback, useEffect, useMemo, useState } from 'react'
import { Prompter, type Mode } from './components/Prompter'
import { Editor } from './components/Editor'
import { parseScript, SAMPLE_SCRIPT } from './lib/script'
import { locate } from './lib/match'
import { speechSupported, useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useWakeLock } from './hooks/useWakeLock'
import { useLocalStorage } from './hooks/useLocalStorage'

const SPOKEN_WINDOW = 6

export default function App() {
  const [text, setText] = useLocalStorage('tp.script', SAMPLE_SCRIPT)
  const [mode, setMode] = useLocalStorage<Mode>('tp.mode', speechSupported ? 'voice' : 'scroll')
  const [speed, setSpeed] = useLocalStorage('tp.speed', 60)
  const [fontSize, setFontSize] = useLocalStorage('tp.fontSize', window.innerWidth < 600 ? 32 : 40)
  const [mirror, setMirror] = useLocalStorage('tp.mirror', false)

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
      // Nothing near the current spot: if we have a solid phrase, search the whole script
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

  // If the mic gets blocked mid-session, drop out of play so the button state is honest.
  const onSpeechError = useCallback(() => setPlaying(false), [])
  const speech = useSpeechRecognition({ onWords, onError: onSpeechError })
  const { start: startMic, stop: stopMic } = speech
  useWakeLock(playing)

  const setPlay = useCallback((on: boolean) => {
    // start the mic synchronously inside the gesture — iOS requires it
    if (on && mode === 'voice') startMic()
    else stopMic()
    setPlaying(on)
  }, [mode, startMic, stopMic])
  const toggle = useCallback(() => setPlay(!playing), [setPlay, playing])
  const pause = useCallback(() => setPlay(false), [setPlay])
  const switchMode = useCallback((m: Mode) => { pause(); setMode(m) }, [pause, setMode])
  const jumpTo = useCallback((index: number) => setJump({ index, id: Date.now() }), [])

  // Keys that toggle play/pause. Besides Space this covers Bluetooth shutter remotes
  // (AB Shutter etc.), which are HID keyboards: the "Android" button sends Enter, the
  // "iOS" button Volume Up (only reaches the page on Android — iOS swallows it), and
  // some clones send a media Play/Pause key.
  const TOGGLE_KEYS = useMemo(() => new Set([
    ' ', 'Enter', 'MediaPlayPause', 'AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown',
  ]), [])

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
  }, [panel, toggle, pause, jumpTo, nextScene, prevScene, TOGGLE_KEYS])

  const currentScene = useMemo(() => {
    let s = null
    for (const sc of script.scenes) if (sc.wordIndex <= current) s = sc
    return s
  }, [script.scenes, current])

  const heardRecently = speech.hearing

  return (
    <div className="app">
      <header className="bar top">
        <button className="btn" onClick={() => { pause(); setPanel('editor') }}>Script</button>
        <div className="seg" role="radiogroup" aria-label="Mode">
          <button
            className={mode === 'voice' ? 'on' : ''}
            onClick={() => switchMode('voice')}
            disabled={!speechSupported}
            title={speechSupported ? 'Follow your voice' : 'Speech recognition is not available in this browser'}
          >
            Voice
          </button>
          <button className={mode === 'scroll' ? 'on' : ''} onClick={() => switchMode('scroll')}>
            Scroll
          </button>
        </div>
        <button className="btn icon" aria-label="Settings" onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          <span className="label">Settings</span>
        </button>
      </header>

      <Prompter
        script={script}
        mode={mode}
        playing={playing}
        current={current}
        speed={speed}
        fontSize={fontSize}
        mirror={mirror}
        jump={jump}
        onToggle={toggle}
        onCurrentChange={setCurrent}
        onReachedEnd={pause}
      />

      <footer className="bar bottom">
        <button
          className="btn"
          onClick={() => setPanel(panel === 'scenes' ? 'none' : 'scenes')}
          disabled={script.scenes.length === 0}
          title="Scenes"
        >
          {currentScene ? currentScene.label : 'Scenes'}
        </button>

        <button className={`play${playing ? ' on' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>
          )}
        </button>

        {mode === 'scroll' ? (
          <label className="slider">
            <span>{speed}</span>
            <input
              type="range" min={10} max={200} step={5} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Scroll speed"
            />
          </label>
        ) : (
          <div className={`mic ${speech.status}${heardRecently ? ' heard' : ''}`} title={speech.error ?? ''}>
            <span className="dot" />
            {speech.status === 'listening' ? (heardRecently ? 'Hearing you' : 'Listening')
              : speech.status === 'starting' ? 'Starting mic…'
              : speech.status === 'error' ? 'Mic blocked'
              : speech.status === 'unsupported' ? 'No speech API'
              : 'Mic off'}
          </div>
        )}
      </footer>

      {speech.error && mode === 'voice' && <div className="toast">{speech.error}</div>}
      {mode === 'voice' && playing && (
        <div className="transcript" aria-live="polite">
          {speech.transcript || (speech.status === 'listening' ? 'Start reading…' : '')}
        </div>
      )}

      {panel === 'editor' && (
        <Editor value={text} onChange={updateText} onDone={() => setPanel('none')} />
      )}

      {panel === 'scenes' && (
        <div className="sheet popover" onClick={() => setPanel('none')}>
          <ul className="scenes" onClick={(e) => e.stopPropagation()}>
            {script.scenes.map((sc) => (
              <li key={sc.label + sc.wordIndex}>
                <button
                  className={currentScene === sc ? 'on' : ''}
                  onClick={() => { jumpTo(sc.wordIndex); setPanel('none') }}
                >
                  <b>{sc.label}</b>
                  <span>{script.lines[sc.lineIndex].words.slice(0, 8).map((w) => w.text).join(' ')}…</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel === 'settings' && (
        <div className="sheet popover" onClick={() => setPanel('none')}>
          <div className="settings" onClick={(e) => e.stopPropagation()}>
            <label>
              <span>Text size <em>{fontSize}px</em></span>
              <input type="range" min={20} max={96} step={2} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              <span>Mirror text (for a beam-splitter glass)</span>
            </label>
            <div className="row">
              <button className="btn" onClick={() => { jumpTo(0); setPanel('none') }}>Back to top</button>
            </div>
            <p className="hint">
              Space / Enter — play / pause · Esc — pause · Home — top · PgUp / PgDn — scenes.<br />
              Bluetooth shutter remotes work as play / pause (on iPhone use the remote's
              “Android” button — iOS keeps the volume key to itself).<br />
              Last key received: <code>{lastKey ?? 'none yet'}</code><br />
              Everything runs on this device; nothing is uploaded.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
