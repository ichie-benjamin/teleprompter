// Generates PNG app icons without any image dependency (raw PNG encoder).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x14, 0x14, 0x19]
const GREY = [0x9a, 0x9a, 0xa3]
const AMBER = [0xf5, 0xb7, 0x3c]

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function inBar(x, y, cx, cy, w, h) {
  const r = h / 2
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0)
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0)
  return dx * dx + dy * dy <= r * r
}

function render(N) {
  const bars = [
    { cy: 0.31, w: 0.5, color: GREY },
    { cy: 0.5, w: 0.62, color: AMBER },
    { cy: 0.69, w: 0.44, color: GREY },
  ]
  const h = 0.095
  const raw = Buffer.alloc((N * 3 + 1) * N)
  for (let y = 0; y < N; y++) {
    raw[y * (N * 3 + 1)] = 0 // filter: none
    for (let x = 0; x < N; x++) {
      // 2x2 supersample for soft edges
      let acc = [0, 0, 0]
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = (x + ox) / N, py = (y + oy) / N
        let c = BG
        for (const b of bars) if (inBar(px, py, 0.5, b.cy, b.w, h)) { c = b.color; break }
        acc = acc.map((v, i) => v + c[i])
      }
      const o = y * (N * 3 + 1) + 1 + x * 3
      raw[o] = acc[0] / 4; raw[o + 1] = acc[1] / 4; raw[o + 2] = acc[2] / 4
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/pwa-192.png', render(192))
writeFileSync('public/pwa-512.png', render(512))
writeFileSync('public/apple-touch-icon.png', render(180))
console.log('icons written')
