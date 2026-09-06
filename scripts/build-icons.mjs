import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Rasterises the app icons.
 *
 * PNG because iOS ignores SVG icons and Android's maskable icons are safest as
 * bitmaps. Written by hand rather than with an image library: the mark is two
 * straight strokes on a flat ground, and a native dependency that has to build
 * on every machine is a poor trade for eighty lines of geometry. The output is
 * committed, so this runs about once a year.
 *
 *   pnpm icons:build
 */

const INK = [0x16, 0x20, 0x2b];
const ACCENT = [0xdd, 0x9c, 0x42];

/**
 * The mark is the letter Č.
 *
 * A caron on its own reads as a chevron — the mark only means "caron" when it
 * sits above something, which is exactly what makes it Slovene. So the icon
 * draws the letter: an open ring with the háček over it, both as round-capped
 * strokes, so it holds together at 48 pixels.
 */

/** Distance from a point to a line segment — the round-capped stroke. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Distance to an arc: the ring's band, with round caps at its two open ends.
 */
function distanceToArc(px, py, cx, cy, radius, startDeg, endDeg) {
  const dx = px - cx;
  const dy = py - cy;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;

  if (angle >= startDeg && angle <= endDeg) {
    return Math.abs(Math.hypot(dx, dy) - radius);
  }

  const toPoint = (deg) => {
    const radians = (deg * Math.PI) / 180;
    return Math.hypot(px - (cx + radius * Math.cos(radians)), py - (cy + radius * Math.sin(radians)));
  };
  return Math.min(toPoint(startDeg), toPoint(endDeg));
}

/**
 * Č, laid out in a 512-unit square.
 *
 * `inset` shrinks the whole letter towards the centre for the maskable
 * variant, where Android may crop anything outside the middle 80%.
 */
function letter(size, { inset }) {
  const scale = size / 512;
  const shrink = inset ? 0.8 : 1;
  const at = (value) => (256 + (value - 256) * shrink) * scale;

  return {
    ring: {
      cx: at(256),
      cy: at(310),
      radius: 125 * shrink * scale,
      // The gap faces east; the stroke runs from there the long way round.
      startDeg: 38,
      endDeg: 322,
      halfStroke: 22 * shrink * scale,
    },
    /*
     * The caron clears the ring by a stroke's width. Touching it would read as
     * one tangled glyph — the whole point is a mark sitting above a letter.
     */
    caron: {
      left: [at(198), at(72)],
      mid: [at(256), at(130)],
      right: [at(314), at(72)],
      halfStroke: 17 * shrink * scale,
    },
  };
}

const SAMPLES = 4;

function render(size, options) {
  const { ring, caron } = letter(size, options);
  const pixels = Buffer.alloc(size * size * 3);
  const step = 1 / SAMPLES;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Supersampled coverage, so the strokes have clean edges at 48px.
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          const onRing =
            distanceToArc(px, py, ring.cx, ring.cy, ring.radius, ring.startDeg, ring.endDeg) <=
            ring.halfStroke;
          const onCaron =
            Math.min(
              distanceToSegment(px, py, caron.left[0], caron.left[1], caron.mid[0], caron.mid[1]),
              distanceToSegment(px, py, caron.mid[0], caron.mid[1], caron.right[0], caron.right[1]),
            ) <= caron.halfStroke;
          if (onRing || onCaron) covered += 1;
        }
      }

      const alpha = covered / (SAMPLES * SAMPLES);
      const offset = (y * size + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          INK[channel] * (1 - alpha) + ACCENT[channel] * alpha,
        );
      }
    }
  }

  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // One filter byte (none) per scanline, then the row.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const OUT = "public/icons";
await mkdir(OUT, { recursive: true });

const jobs = [
  { name: "icon-192.png", size: 192, inset: false },
  { name: "icon-512.png", size: 512, inset: false },
  { name: "apple-touch-icon.png", size: 180, inset: false },
  { name: "maskable-192.png", size: 192, inset: true },
  { name: "maskable-512.png", size: 512, inset: true },
  { name: "favicon.png", size: 48, inset: false },
];

for (const job of jobs) {
  const png = encodePng(job.size, render(job.size, { inset: job.inset }));
  await writeFile(path.join(OUT, job.name), png);
  console.log(`${job.name.padEnd(22)} ${job.size}×${job.size}  ${(png.length / 1024).toFixed(1)} kB`);
}
