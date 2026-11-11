// Genera foto segnaposto (PNG validi, sfumatura a tinta unita) senza dipendenze
// esterne: servono solo per avere file reali da servire da /uploads.
import fs from 'fs/promises'
import path from 'path'
import zlib from 'zlib'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8 bit, RGB
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const k = 0.55 + 0.45 * (1 - y / height) // sfumatura verticale
    raw[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3
      raw[o] = Math.round(r * k); raw[o + 1] = Math.round(g * k); raw[o + 2] = Math.round(b * k)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}

export const SEED_FILE_PREFIX = 'seed_'

export const PLACEHOLDERS = [
  { name: 'sea',   rgb: [30, 120, 190] },
  { name: 'lake',  rgb: [40, 150, 140] },
  { name: 'fish',  rgb: [200, 140, 60] },
  { name: 'dawn',  rgb: [230, 120, 90] },
  { name: 'gear',  rgb: [90, 100, 120] },
  { name: 'shore', rgb: [160, 150, 110] }
].map(p => ({ ...p, filename: `${SEED_FILE_PREFIX}${p.name}.png` }))

export async function writePlaceholders(dir) {
  await fs.mkdir(dir, { recursive: true })
  for (const p of PLACEHOLDERS) {
    const buf = png(640, 480, p.rgb)
    await fs.writeFile(path.join(dir, p.filename), buf)
    p.size = buf.length
  }
}

// Cancella solo i file con prefisso "seed_" (mai altro in /uploads).
export async function removePlaceholders(dir) {
  let removed = 0
  let files = []
  try { files = await fs.readdir(dir) } catch { return 0 }
  for (const f of files) {
    if (f.startsWith(SEED_FILE_PREFIX)) { await fs.unlink(path.join(dir, f)); removed++ }
  }
  return removed
}
