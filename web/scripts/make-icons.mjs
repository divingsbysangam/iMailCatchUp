// Generates the PNG app icons without any image dependencies. Run: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BLUE = [0x1d, 0x4e, 0xd8, 255];
const WHITE = [255, 255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x / size, y / size);
      raw.set(p, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
function roundedInside(u, v, r) {
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
function distToSeg(px, py, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}
// scale: envelope size relative to icon (smaller for maskable safe zone)
function icon(scale, rounded) {
  return (u, v) => {
    if (rounded && !roundedInside(u, v, 0.22)) return [0, 0, 0, 0];
    const x = 0.5 + (u - 0.5) / scale, y = 0.5 + (v - 0.5) / scale;
    const inEnv = x > 0.19 && x < 0.81 && y > 0.28 && y < 0.72;
    if (!inEnv) return BLUE;
    const onFlap = Math.min(distToSeg(x, y, 0.2, 0.31, 0.5, 0.53), distToSeg(x, y, 0.5, 0.53, 0.8, 0.31)) < 0.032;
    return onFlap ? BLUE : WHITE;
  };
}
writeFileSync("public/icon-192.png", png(192, icon(1, true)));
writeFileSync("public/icon-512.png", png(512, icon(1, true)));
writeFileSync("public/icon-maskable-512.png", png(512, icon(0.7, false)));
console.log("icons written");
