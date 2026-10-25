import zlib from 'node:zlib';

// Minimal RGBA canvas + PNG encoder so sprite generation needs no npm packages.
export class Bitmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  px(x, y, color) {
    x = Math.round(x); y = Math.round(y);
    if (!color || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = rgba(color);
    const i = (y * this.w + x) * 4;
    if (a === 255) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255; return; }
    const da = this.data[i + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(([r, g, b][k] * sa + this.data[i + k] * da * (1 - sa)) / (oa || 1));
    this.data[i + 3] = Math.round(oa * 255);
  }

  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
  }

  // Rect with 1px outline and clipped corners: the basic pixel-art blob.
  blob(x, y, w, h, fill, outline) {
    this.rect(x + 1, y, w - 2, h, outline);
    this.rect(x, y + 1, w, h - 2, outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.px(x, y, color);
  }

  line(x0, y0, x1, y1, color) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, color);
  }

  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      this.data.copy(raw, y * (this.w * 4 + 1) + 1, y * this.w * 4, (y + 1) * this.w * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const cache = new Map();
export function rgba(c) {
  if (Array.isArray(c)) return c.length === 4 ? c : [...c, 255];
  if (cache.has(c)) return cache.get(c);
  let h = c.replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  const v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
  cache.set(c, v);
  return v;
}

export function shade(c, f) {
  const [r, g, b, a] = rgba(c);
  const k = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return [k(r), k(g), k(b), a];
}
