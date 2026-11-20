import fs from 'node:fs';
import crypto from 'node:crypto';
import type { QueueItem, QueueSummary } from '../../../shared/protocol';
import { writeFileAtomic } from '../session-store';

export interface QueueRecord {
  id: string;
  sessionNo: number;
  /** Nama file di Drive, mis. "PHOTO #042.png". */
  name: string;
  sizeBytes: number;
  status: QueueItem['status'];
  /** Jumlah percobaan upload sejauh ini. */
  attempts: number;
  progress: number;
  createdAt: number;
  /** Waktu paling awal item boleh dicoba lagi (epoch ms). */
  nextAttemptAt: number;
  error?: string;
  driveFileId?: string;
  finishedAt?: number;
}

interface QueueFile {
  version: 1;
  items: QueueRecord[];
}

/**
 * Antrean upload yang disimpan ke disk (data/upload-queue.json), jadi tidak hilang kalau server mati.
 * Satu item per sesi. Item 'uploading' yang tertinggal saat server mati dikembalikan ke 'queued'.
 */
export class UploadQueue {
  private items: QueueRecord[] = [];
  /** Dipanggil setiap ada perubahan (untuk menyiarkan ke panel operator). */
  onChange?: () => void;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<QueueFile>;
      if (Array.isArray(raw.items)) this.items = raw.items.filter((i) => i && typeof i.id === 'string');
    } catch {
      this.items = [];
    }
    let recovered = false;
    for (const it of this.items) {
      if (it.status === 'uploading') {
        it.status = 'queued';
        it.progress = 0;
        it.nextAttemptAt = this.now();
        recovered = true;
      }
    }
    if (recovered) this.save(false);
  }

  private save(notify = true): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, items: this.items } satisfies QueueFile, null, 2));
    if (notify) this.onChange?.();
  }

  hasSession(sessionNo: number): boolean {
    return this.items.some((i) => i.sessionNo === sessionNo);
  }

  get(id: string): QueueRecord | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** Masukkan sesi ke antrean. Idempoten: sesi yang sudah ada tidak ditambahkan lagi. */
  enqueue(sessionNo: number, name: string, sizeBytes: number): QueueRecord {
    const existing = this.items.find((i) => i.sessionNo === sessionNo);
    if (existing) return existing;
    const t = this.now();
    const rec: QueueRecord = {
      id: crypto.randomUUID(),
      sessionNo,
      name,
      sizeBytes,
      status: 'queued',
      attempts: 0,
      progress: 0,
      createdAt: t,
      nextAttemptAt: t,
    };
    this.items.push(rec);
    this.save();
    return rec;
  }

  /** Item tertua yang sudah waktunya dicoba. */
  nextDue(now = this.now()): QueueRecord | undefined {
    return this.items
      .filter((i) => i.status === 'queued' && i.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  /** Kapan item 'queued' berikutnya jatuh tempo (null bila tidak ada). */
  earliestDueAt(): number | null {
    const due = this.items.filter((i) => i.status === 'queued').map((i) => i.nextAttemptAt);
    return due.length ? Math.min(...due) : null;
  }

  markUploading(id: string): QueueRecord | undefined {
    const it = this.get(id);
    if (!it) return undefined;
    it.status = 'uploading';
    it.attempts += 1;
    it.progress = 0.5; // upload dikirim sekaligus: tidak ada progres per-byte, jadi ditandai separuh jalan
    this.save();
    return it;
  }

  markDone(id: string, driveFileId: string): QueueRecord | undefined {
    const it = this.get(id);
    if (!it) return undefined;
    Object.assign(it, { status: 'done', progress: 1, driveFileId, finishedAt: this.now(), error: undefined });
    this.save();
    return it;
  }

  /** Gagal sementara: kembali ke 'queued' dan dicoba lagi pada `nextAttemptAt`. */
  markRetry(id: string, error: string, nextAttemptAt: number): QueueRecord | undefined {
    const it = this.get(id);
    if (!it) return undefined;
    Object.assign(it, { status: 'queued', progress: 0, error, nextAttemptAt });
    this.save();
    return it;
  }

  /** Gagal permanen: menunggu operator menekan RETRY. */
  markFailed(id: string, error: string): QueueRecord | undefined {
    const it = this.get(id);
    if (!it) return undefined;
    Object.assign(it, { status: 'failed', error, finishedAt: this.now() });
    this.save();
    return it;
  }

  /** RETRY dari operator: satu item gagal, atau semua yang gagal bila `id` kosong. */
  retry(id?: string): number {
    let n = 0;
    for (const it of this.items) {
      if (it.status === 'failed' && (!id || it.id === id)) {
        Object.assign(it, { status: 'queued', attempts: 0, progress: 0, error: undefined, nextAttemptAt: this.now() });
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  /** Internet kembali: semua item yang sedang menunggu backoff boleh dicoba sekarang. */
  expedite(): void {
    const t = this.now();
    let changed = false;
    for (const it of this.items) {
      if (it.status === 'queued' && it.nextAttemptAt > t) {
        it.nextAttemptAt = t;
        changed = true;
      }
    }
    if (changed) this.save(false);
  }

  list(limit = 100): QueueItem[] {
    return [...this.items]
      .sort((a, b) => b.sessionNo - a.sessionNo)
      .slice(0, limit)
      .map((i) => ({
        id: i.id,
        sessionNo: i.sessionNo,
        file: i.name,
        sizeBytes: i.sizeBytes,
        status: i.status,
        attempts: i.attempts,
        progress: i.progress,
        nextAttemptAt: i.status === 'queued' && i.attempts > 0 ? i.nextAttemptAt : undefined,
        error: i.error,
      }));
  }

  summary(): QueueSummary {
    const s: QueueSummary = { queued: 0, uploading: 0, done: 0, failed: 0 };
    for (const i of this.items) s[i.status]++;
    return s;
  }
}
