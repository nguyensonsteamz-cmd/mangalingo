/** Renders the toolbar icons (PNG) without image dependencies: supersampled shapes → zlib PNG. */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [17, 19, 26, 255];
const ACCENT = [124, 156, 255, 255];

// Shapes in 0..1 space: rounded square, speech bubble with tail, two "text lines".
function shade(x, y) {
  const r = 0.22;
  const inset = 0.02;
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - inset - r), 0);
  const qy = Math.max(Math.abs(y - 0.5) - (0.5 - inset - r), 0);
  if (Math.hypot(qx, qy) > r) return null;
  const ex = (x - 0.5) / 0.34;
  const ey = (y - 0.46) / 0.27;
  const inTail = y > 0.6 && y < 0.84 && x > 0.3 && x < 0.47 && x - 0.3 < (0.84 - y) * 0.75;
  if (ex * ex + ey * ey <= 1 || inTail) {
    if (Math.abs(y - 0.4) < 0.03 && x > 0.32 && x < 0.68) return BG;
    if (Math.abs(y - 0.52) < 0.03 && x > 0.32 && x < 0.58) return BG;
    return ACCENT;
  }
  return BG;
}

export async function makeIcons(outDir) {
  await mkdir(outDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const ss = 4;
    const buf = Buffer.alloc(size * size * 4);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        let rs = 0, gs = 0, bs = 0, as = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
            if (c) {
              rs += c[0] * c[3];
              gs += c[1] * c[3];
              bs += c[2] * c[3];
              as += c[3];
            }
          }
        }
        const i = (py * size + px) * 4;
        if (as > 0) {
          buf[i] = rs / as;
          buf[i + 1] = gs / as;
          buf[i + 2] = bs / as;
        }
        buf[i + 3] = as / (ss * ss);
      }
    }
    await writeFile(join(outDir, `icon-${size}.png`), encodePng(size, size, buf));
  }
}
