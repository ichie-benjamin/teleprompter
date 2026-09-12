export interface Word {
  text: string
  /** lowercased, accent- and punctuation-stripped form used for matching ('' if none) */
  norm: string
  index: number
  line: number
}

export interface Line {
  index: number
  words: Word[]
  heading: boolean
}

export interface Scene {
  label: string
  wordIndex: number
  lineIndex: number
}

export interface ParsedScript {
  lines: Line[]
  words: Word[]
  scenes: Scene[]
}

// [S7], [s7], [Scene 7]
const MARKER = /\[s(?:cene)?\s*(\d+)\]/gi

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function parseScript(text: string): ParsedScript {
  const lines: Line[] = []
  const words: Word[] = []
  const scenes: Scene[] = []
  let pending: string[] = []

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    let s = raw.replace(MARKER, (_, n: string) => {
      pending.push(`S${n}`)
      return ' '
    })
    const heading = /^\s*#{1,6}\s/.test(s)
    s = s
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
      .replace(/[*_`~]{1,3}/g, '')
      .trim()
    if (!s) continue

    const line: Line = { index: lines.length, words: [], heading }
    for (const t of s.split(/\s+/)) {
      const w: Word = { text: t, norm: normalizeWord(t), index: words.length, line: line.index }
      if (pending.length) {
        for (const label of pending) scenes.push({ label, wordIndex: w.index, lineIndex: line.index })
        pending = []
      }
      line.words.push(w)
      words.push(w)
    }
    lines.push(line)
  }
  return { lines, words, scenes }
}

export const SAMPLE_SCRIPT = `[S1] Welcome to Prompter.
This is a teleprompter that listens as you read. The line you're on stays bright, the words you've already said fade back, and the page scrolls to keep up with you.

If you stop talking, nothing moves. Take a breath, check your notes, and pick up where you left off.

[S2] Switch to Scroll mode if you'd rather not use the microphone. The text glides past at a steady speed, and you can nudge it faster or slower with the slider at the bottom.

Tap anywhere on the text to pause or resume. On a laptop, the space bar does the same thing.

[S3] Scene markers like this one become jump points. Open the scenes list, tap a scene, and the prompter snaps straight to it.

Paste your own script, or load a text or markdown file, and you're ready to record.`
