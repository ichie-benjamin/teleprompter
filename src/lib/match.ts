function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/** Similarity of two normalized words: 1 = same, negative = different. */
export function wordSim(a: string, b: string): number {
  if (!a || !b) return -0.6
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (la >= 4 && lb >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.85
  const maxLen = Math.max(la, lb)
  if (maxLen >= 4) {
    const d = levenshtein(a, b)
    if (d <= 1) return 0.8
    if (maxLen >= 7 && d <= 2) return 0.7
  }
  return -0.6
}

export interface LocateOptions {
  /** how far behind the anchor we are willing to look */
  behind?: number
  /** how far ahead of the anchor we are willing to look */
  ahead?: number
  /** minimum alignment score before we accept a move */
  minScore?: number
}

/**
 * Local alignment (Smith–Waterman style) of the last few spoken words against a
 * window of the script around `anchor`. Returns the script index the speaker
 * has most likely just reached, or -1 if nothing convincing was found.
 */
export function locate(
  spoken: string[],
  script: string[],
  anchor: number,
  { behind = 8, ahead = 80, minScore = 1.9 }: LocateOptions = {},
): number {
  const K = spoken.length
  if (!K || !script.length) return -1
  const lo = Math.max(0, anchor - behind)
  const hi = Math.min(script.length - 1, anchor + ahead)
  const W = hi - lo + 1
  if (W <= 0) return -1

  const GAP = 0.5
  let prev = new Float32Array(W + 1)
  let cur = new Float32Array(W + 1)
  for (let i = 1; i <= K; i++) {
    cur[0] = 0
    for (let j = 1; j <= W; j++) {
      const s = wordSim(spoken[i - 1], script[lo + j - 1])
      cur[j] = Math.max(0, prev[j - 1] + s, prev[j] - GAP, cur[j - 1] - GAP)
    }
    ;[prev, cur] = [cur, prev]
  }

  let best = -1
  let bestScore = 0
  for (let j = 1; j <= W; j++) {
    const idx = lo + j - 1
    // tiny bias toward the anchor so repeated phrases resolve to the nearest one
    const score = prev[j] - Math.abs(idx - anchor) * 0.01
    if (score > bestScore) {
      bestScore = score
      best = idx
    }
  }
  return bestScore >= minScore ? best : -1
}
