// Renders the app icon to PNG without image dependencies (same shapes as public/icon.svg).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [11, 13, 16], FG = [198, 244, 50];
function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function render(size, maskable) {
  const s = size / 64, pad = maskable ? 0.1 : 0;
  const px = (x, y) => {
    // map into 64-unit space, shrinking content for maskable safe zone
    const u = (x / s - 32) / (1 - 2 * pad) + 32, v = (y / s - 32) / (1 - 2 * pad) + 32;
    const inRect = (rx, ry, w, h) => u >= rx && u < rx + w && v >= ry && v < ry + h;
    if (inRect(14, 12, 9, 40) || inRect(14, 43, 26, 9)) return FG;
    const d = Math.hypot(u - 46, v - 22);
    if (d >= 4 && d <= 8) return FG;
    return BG;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) { const c = px(x + 0.5, y + 0.5); raw.set(c, y * (size * 3 + 1) + 1 + x * 3); }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync('public/icon-192.png', render(192, false));
writeFileSync('public/icon-512.png', render(512, true));
writeFileSync('public/apple-touch-icon.png', render(180, false));
