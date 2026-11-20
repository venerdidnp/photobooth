import fs from 'node:fs';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, type Settings } from '../../shared/protocol';
import { writeFileAtomic } from './session-store';

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Ambil hanya field yang dikenal, batasi rentang angkanya, dan isi sisanya dari `base`. */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = SETTINGS_LIMITS;
  return {
    frameId: typeof r.frameId === 'string' || r.frameId === null ? (r.frameId as string | null) : base.frameId,
    countdownSec: clampInt(r.countdownSec, L.countdownSec.min, L.countdownSec.max, base.countdownSec),
    pauseSec: clampInt(r.pauseSec, L.pauseSec.min, L.pauseSec.max, base.pauseSec),
    mirrorPreview: typeof r.mirrorPreview === 'boolean' ? r.mirrorPreview : base.mirrorPreview,
    sound: typeof r.sound === 'boolean' ? r.sound : base.sound,
    flash: typeof r.flash === 'boolean' ? r.flash : base.flash,
  };
}

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      raw = {};
    }
    this.current = sanitizeSettings(raw);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: unknown): Settings {
    const merged = { ...this.current, ...(patch && typeof patch === 'object' ? patch : {}) };
    this.current = sanitizeSettings(merged, this.current);
    writeFileAtomic(this.file, JSON.stringify(this.current, null, 2));
    return this.current;
  }
}
