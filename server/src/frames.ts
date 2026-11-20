import fs from 'node:fs';
import path from 'node:path';
import type { FrameInfo, SlotRect } from '../../shared/protocol';

/**
 * Format frames/<id>.json:
 * {
 *   "name": "Sunset",          // opsional, default = id
 *   "image": "sunset.png",     // opsional, default = <id>.png
 *   "width": 800, "height": 2000,   // ukuran canvas strip (piksel) = ukuran PNG frame
 *   "slots": [ {"x":80,"y":100,"width":640,"height":480}, ... ]   // koordinat lubang foto
 * }
 */
export interface FrameJson {
  name?: string;
  image?: string;
  width: number;
  height: number;
  slots: SlotRect[];
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Mengembalikan pesan error (bahasa Indonesia) atau null kalau valid. */
export function validateFrameJson(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'isi JSON bukan objek';
  const f = raw as Partial<FrameJson>;
  if (!isPosInt(f.width) || !isPosInt(f.height)) return 'width/height harus bilangan bulat positif';
  if (!Array.isArray(f.slots) || f.slots.length < 1) return 'slots harus berisi minimal 1 slot';
  for (const [i, s] of f.slots.entries()) {
    const n = i + 1;
    if (!s || !isNonNegInt(s.x) || !isNonNegInt(s.y) || !isPosInt(s.width) || !isPosInt(s.height)) {
      return `slot ${n}: x, y, width, height harus bilangan bulat (width/height > 0)`;
    }
    if (s.x + s.width > f.width || s.y + s.height > f.height) return `slot ${n} keluar dari canvas`;
  }
  if (f.image !== undefined && (typeof f.image !== 'string' || f.image !== path.basename(f.image))) {
    return 'image harus berupa nama file saja (tanpa folder)';
  }
  return null;
}

export interface FrameScan {
  frames: FrameInfo[];
  /** File yang dilewati beserta alasannya (ditampilkan di log server). */
  skipped: { file: string; reason: string }[];
}

/** Baca semua frames/*.json. Menambah frame baru = taruh PNG + JSON, tanpa ubah kode. */
export function scanFrames(framesDir: string): FrameScan {
  const frames: FrameInfo[] = [];
  const skipped: FrameScan['skipped'] = [];
  if (!fs.existsSync(framesDir)) return { frames, skipped };

  for (const file of fs.readdirSync(framesDir).sort()) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const id = file.slice(0, -'.json'.length);
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(framesDir, file), 'utf8')) as FrameJson;
      const problem = validateFrameJson(raw);
      if (problem) {
        skipped.push({ file, reason: problem });
        continue;
      }
      const image = raw.image ?? `${id}.png`;
      if (!fs.existsSync(path.join(framesDir, image))) {
        skipped.push({ file, reason: `file gambar ${image} tidak ditemukan` });
        continue;
      }
      frames.push({
        id,
        name: raw.name ?? id,
        width: raw.width,
        height: raw.height,
        slots: raw.slots,
        imageUrl: `/frames/${encodeURIComponent(image)}`,
      });
    } catch (err) {
      skipped.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { frames, skipped };
}
