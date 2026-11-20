/**
 * Membuat frame contoh untuk testing: frames/sunset.png (PNG transparan dengan 3 lubang) + frames/sunset.json.
 * Jalankan: npm run make-frame
 *
 * Warna di sini sama dengan token palet sunset di Figma (hanya untuk menggambar PNG ini, bukan UI).
 * Frame asli dari panitia cukup ditaruh sebagai PNG + JSON di folder frames/ dengan format yang sama.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const W = 800;
const H = 2000;
const SLOT_W = 640;
const SLOT_H = 480;
const SLOT_X = 80;
const SLOT_YS = [100, 640, 1180];
const BORDER = 14;
const CELL = 20; // ukuran "piksel" besar supaya terlihat pixel-art

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const PURPLE = hex('#7a3eb1');
const PINK_STRONG = hex('#d91a7c');
const PINK = hex('#ff2e93');
const ORANGE = hex('#ff7a2f');
const YELLOW = hex('#ffc93c');
const INK = hex('#2b1055');
const CREAM = hex('#fff4e0');

const png = new PNG({ width: W, height: H });
const set = (x: number, y: number, c: RGB, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (W * y + x) << 2;
  png.data[i] = c[0];
  png.data[i + 1] = c[1];
  png.data[i + 2] = c[2];
  png.data[i + 3] = a;
};
const rect = (x: number, y: number, w: number, h: number, c: RGB, a = 255) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, c, a);
};

// 1) langit sunset: pita warna berundak dari ungu (atas) ke kuning (bawah)
const bands = [PURPLE, PURPLE, PINK_STRONG, PINK_STRONG, PINK, ORANGE, ORANGE, YELLOW];
const bandH = Math.ceil(H / bands.length);
bands.forEach((c, i) => rect(0, i * bandH, W, bandH, c));

// 2) matahari pixel-art di area bawah (di bawah slot 3)
const sunCx = W / 2;
const sunCy = 1840;
const sunR = 100;
for (let y = sunCy - sunR; y < sunCy + sunR; y += CELL) {
  for (let x = sunCx - sunR; x < sunCx + sunR; x += CELL) {
    const dx = x + CELL / 2 - sunCx;
    const dy = y + CELL / 2 - sunCy;
    if (dx * dx + dy * dy <= sunR * sunR) rect(x, y, CELL, CELL, CREAM);
  }
}

// 3) tulisan kecil "HIMATIFA 6" dengan font bitmap 5x7
const GLYPHS: Record<string, string[]> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const text = 'HIMATIFA 6';
const px = 6;
const textW = text.length * 6 * px - px;
let tx = Math.round((W - textW) / 2);
const ty = 1700;
for (const ch of text) {
  const g = GLYPHS[ch]!;
  g.forEach((row, ry) =>
    [...row].forEach((bit, rx) => {
      if (bit === '1') rect(tx + rx * px, ty + ry * px, px, px, INK);
    }),
  );
  tx += 6 * px;
}

// 4) lubang slot: bingkai tinta di sekeliling, lalu transparan di dalamnya
for (const y of SLOT_YS) {
  rect(SLOT_X - BORDER, y - BORDER, SLOT_W + BORDER * 2, SLOT_H + BORDER * 2, INK);
}
for (const y of SLOT_YS) {
  rect(SLOT_X, y, SLOT_W, SLOT_H, [0, 0, 0], 0);
}

const framesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frames');
fs.mkdirSync(framesDir, { recursive: true });
fs.writeFileSync(path.join(framesDir, 'sunset.png'), PNG.sync.write(png));
fs.writeFileSync(
  path.join(framesDir, 'sunset.json'),
  JSON.stringify(
    {
      name: 'Sunset',
      image: 'sunset.png',
      width: W,
      height: H,
      slots: SLOT_YS.map((y) => ({ x: SLOT_X, y, width: SLOT_W, height: SLOT_H })),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Frame contoh dibuat di ${framesDir} (sunset.png + sunset.json)`);
