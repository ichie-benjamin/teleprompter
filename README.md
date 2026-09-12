# Prompter

A small teleprompter that follows your voice. React + Vite, installable as a PWA, runs entirely on-device.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (includes manifest + service worker)
npm run preview    # serve the production build locally
```

Voice mode needs a browser with the Web Speech API (Chrome, Edge, Safari 14.5+, Android Chrome) and, outside `localhost`, an **https** origin — the mic is not available on plain http.

## Features

- **Voice follow** — `SpeechRecognition` streams what you say; the last few recognised words are aligned to the script (local alignment with fuzzy word matching), the highlight moves to that spot and the page scrolls to keep it on the reading line. Stop talking and nothing moves.
- **Scroll mode** — plain timed scroll with a speed slider, for when you'd rather not use the mic. The paragraph on the reading line is highlighted.
- **Play / pause** — tap anywhere on the text, the big button, or `Space`. `Esc` pauses, `Home` returns to the top.
- **Script in** — paste text or load a `.txt` / `.md`. Markers like `[S7]` (also `[Scene 7]`) become scene jump points. Markdown headings / emphasis are stripped for reading. The script and settings persist in `localStorage`.
- **Settings** — text size, mirror (for beam-splitter glass).
- **PWA** — add to home screen on the phone, works offline. The screen stays awake while playing (Wake Lock API where available).

## Layout

```
src/
  lib/script.ts                 parse text → lines / words / scenes
  lib/match.ts                  align spoken words to the script
  hooks/useSpeechRecognition.ts Web Speech API wrapper with auto-restart
  hooks/useWakeLock.ts
  hooks/useLocalStorage.ts
  components/Prompter.tsx       reading view, highlight, scrolling (both modes)
  components/Editor.tsx         paste / load script
  App.tsx                       state, bars, panels, keyboard
scripts/make-icons.mjs          regenerates the PNG icons (npm run icons)
```
