// Generates icons/veto.png (128x128 RGBA) from scratch using zlib — no external deps.
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 128, H = 128;
const buf = Buffer.alloc(W * H * 4, 0);

function px(x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
}

function circle(cx, cy, rad, r, g, b, thick = 2.5) {
  for (let a = 0; a < 360; a += 0.3) {
    const rad2 = a * Math.PI / 180;
    for (let t = -thick; t <= thick; t += 0.5) {
      px(cx + (rad + t) * Math.cos(rad2), cy + (rad + t) * Math.sin(rad2), r, g, b);
    }
  }
}

function line(x1, y1, x2, y2, r, g, b, thick = 3) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  for (let i = 0; i <= len; i += 0.5) {
    const t = i / len, cx = x1 + t * dx, cy = y1 + t * dy;
    for (let tx = -thick; tx <= thick; tx++)
      for (let ty = -thick; ty <= thick; ty++)
        if (tx * tx + ty * ty <= thick * thick) px(cx + tx, cy + ty, r, g, b);
  }
}

function dot(cx, cy, rad, r, g, b) {
  for (let y = cy - rad - 1; y <= cy + rad + 1; y++)
    for (let x = cx - rad - 1; x <= cx + rad + 1; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) px(x, y, r, g, b);
}

// Dark background
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) px(x, y, 18, 18, 30);

// Scale: SVG viewBox 0 0 24 24 → 128x128
const s = 128 / 24;

// Outer circle (cx=12 cy=12 r=10)
circle(12 * s, 12 * s, 10 * s, 255, 255, 255, 2.5);

// V shape: M8 8 L12 16 L16 8
line(8 * s, 8 * s, 12 * s, 16 * s, 255, 255, 255, 3.5);
line(12 * s, 16 * s, 16 * s, 8 * s, 255, 255, 255, 3.5);

// Top dot (cx=12 cy=5 r=1.5)
dot(12 * s, 5 * s, 1.5 * s, 255, 255, 255);

// --- PNG encoding ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t   = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  buf.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'icons', 'veto.png');
fs.writeFileSync(out, png);
console.log(`Written ${png.length} bytes → ${out}`);
