import fs from 'node:fs';
import path from 'node:path';
import { formatSessionNo, type SessionSummary } from '../../shared/protocol';

export interface SessionMeta {
  no: number;
  createdAt: string;
  finishedAt?: string;
  frameId: string;
  slotCount: number;
  status: SessionSummary['status'];
  /** Revisi foto per slot (0 = belum ada). */
  slotRevs: number[];
  stripRev: number;
  /** Berapa kali operator memulai retake. */
  retakes: number;
  /** Diisi Fase 2. Tanpa nilai ini sesi dianggap 'queued'. */
  upload?: {
    status: SessionSummary['uploadStatus'];
    driveFileId?: string;
    uploadedAt?: string;
    error?: string;
  };
}

/** Tulis lewat file sementara + rename supaya tidak pernah menyisakan file setengah jadi. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const META_STATUSES: ReadonlySet<SessionMeta['status']> = new Set([
  'in_progress',
  'finalized',
  'cancelled',
  'abandoned',
]);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isSessionMeta(raw: unknown): raw is SessionMeta {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Record<string, unknown>;
  return (
    isFiniteNumber(m.no) &&
    Number.isInteger(m.no) &&
    m.no > 0 &&
    typeof m.createdAt === 'string' &&
    typeof m.frameId === 'string' &&
    isFiniteNumber(m.slotCount) &&
    Number.isInteger(m.slotCount) &&
    m.slotCount > 0 &&
    typeof m.status === 'string' &&
    META_STATUSES.has(m.status as SessionMeta['status']) &&
    Array.isArray(m.slotRevs) &&
    m.slotRevs.every(isFiniteNumber) &&
    isFiniteNumber(m.stripRev) &&
    isFiniteNumber(m.retakes)
  );
}

export function toSummary(meta: SessionMeta): SessionSummary {
  return {
    no: meta.no,
    label: formatSessionNo(meta.no),
    status: meta.status,
    createdAt: meta.createdAt,
    finishedAt: meta.finishedAt,
    frameId: meta.frameId,
    slotCount: meta.slotCount,
    slotRevs: meta.slotRevs,
    stripRev: meta.stripRev,
    uploadStatus: meta.upload?.status ?? 'queued',
  };
}

/**
 * Penyimpanan sesi di disk: data/sessions/<nomor>/{slot-N.jpg, strip.png, meta.json}
 * Nomor berurutan (001, 002, ...) dan tetap berlanjut setelah restart: nomor berikutnya selalu
 * max(counter.json, nomor folder terbesar yang ada) + 1, jadi tidak pernah menimpa sesi lama
 * walaupun counter.json hilang/rusak.
 */
export class SessionStore {
  constructor(readonly dataDir: string) {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  get sessionsDir(): string {
    return path.join(this.dataDir, 'sessions');
  }

  private get counterFile(): string {
    return path.join(this.dataDir, 'counter.json');
  }

  dir(no: number): string {
    return path.join(this.sessionsDir, formatSessionNo(no));
  }

  shotPath(no: number, slot: number): string {
    return path.join(this.dir(no), `slot-${slot}.jpg`);
  }

  stripPath(no: number): string {
    return path.join(this.dir(no), 'strip.png');
  }

  private metaPath(no: number): string {
    return path.join(this.dir(no), 'meta.json');
  }

  private readCounter(): number {
    try {
      const raw = JSON.parse(fs.readFileSync(this.counterFile, 'utf8')) as { last?: unknown };
      return typeof raw.last === 'number' && Number.isInteger(raw.last) && raw.last >= 0 ? raw.last : 0;
    } catch {
      return 0;
    }
  }

  private maxExisting(): number {
    let max = 0;
    for (const entry of fs.readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) max = Math.max(max, Number(entry.name));
    }
    return max;
  }

  /** Nomor yang akan dipakai sesi berikutnya (tanpa mengambilnya). */
  peekNext(): number {
    return Math.max(this.readCounter(), this.maxExisting()) + 1;
  }

  /** Ambil nomor berikutnya, simpan ke counter.json, dan buat foldernya. */
  reserveNext(): number {
    const no = this.peekNext();
    writeFileAtomic(this.counterFile, JSON.stringify({ last: no }));
    fs.mkdirSync(this.dir(no), { recursive: true });
    return no;
  }

  writeMeta(meta: SessionMeta): void {
    writeFileAtomic(this.metaPath(meta.no), JSON.stringify(meta, null, 2));
  }

  readMeta(no: number): SessionMeta | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.metaPath(no), 'utf8')) as unknown;
      return isSessionMeta(raw) && raw.no === no ? raw : null;
    } catch {
      return null;
    }
  }

  updateMeta(no: number, patch: (m: SessionMeta) => SessionMeta | void): SessionMeta | null {
    const meta = this.readMeta(no);
    if (!meta) return null;
    const next = patch(meta) ?? meta;
    this.writeMeta(next);
    return next;
  }

  writeShot(no: number, slot: number, data: Buffer): void {
    writeFileAtomic(this.shotPath(no, slot), data);
  }

  writeStrip(no: number, data: Buffer): void {
    writeFileAtomic(this.stripPath(no), data);
  }

  hasStrip(no: number): boolean {
    return fs.existsSync(this.stripPath(no));
  }

  /** Semua sesi yang punya meta.json, terbaru dulu. */
  list(): SessionMeta[] {
    const metas: SessionMeta[] = [];
    for (const entry of fs.readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const meta = this.readMeta(Number(entry.name));
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.no - a.no);
  }

  /** Dipanggil saat server menyala: sesi yang masih 'in_progress' berarti server mati di tengah sesi. */
  markAbandoned(): number {
    let n = 0;
    for (const meta of this.list()) {
      if (meta.status === 'in_progress') {
        this.writeMeta({ ...meta, status: 'abandoned' });
        n++;
      }
    }
    return n;
  }
}
