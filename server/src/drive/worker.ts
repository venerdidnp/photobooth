import { backoffMs, DriveError, MAX_TRANSIENT_ATTEMPTS, NETWORK_BACKOFF, TRANSIENT_BACKOFF } from './errors';
import type { QueueRecord, UploadQueue } from './queue';

export interface UploadJob {
  name: string;
  data: Buffer;
  /** Kunci unik sesi, supaya upload yang diulang tidak membuat file ganda di Drive. */
  sessionKey: string;
}

export interface Uploader {
  upload(job: UploadJob): Promise<{ fileId: string }>;
}

export interface WorkerDeps {
  queue: UploadQueue;
  uploader: Uploader;
  isConfigured: () => boolean;
  readFile: (rec: QueueRecord) => Buffer | Promise<Buffer>;
  sessionKey: (rec: QueueRecord) => string;
  /** Dipanggil setiap status item berubah (untuk meta.json sesi). */
  onStatus?: (rec: QueueRecord) => void;
  /** true = jaringan berhasil, false = jaringan gagal. */
  onNetwork?: (ok: boolean) => void;
  /** Kegagalan otorisasi/izin (token dicabut, folder tidak bisa diakses). */
  onAuthProblem?: (message: string) => void;
  onSuccess?: () => void;
  now?: () => number;
  log?: (msg: string) => void;
  random?: () => number;
}

const IDLE_RECHECK_MS = 5_000;

/**
 * Mengupload item antrean satu per satu di latar belakang. Tidak pernah memblok sesi foto:
 * semua kerja asinkron dan hanya dipicu oleh kick()/timer.
 */
export class UploadWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private rerun = false;

  constructor(private readonly d: WorkerDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  start(): void {
    this.stopped = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Bangunkan worker sekarang (ada item baru, RETRY, internet kembali, dll). */
  kick(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.loop();
  }

  private async loop(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        while (!this.stopped && (await this.runOnce())) {
          /* lanjut ke item berikutnya */
        }
      } while (this.rerun && !this.stopped);
    } finally {
      this.running = false;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    const due = this.d.queue.earliestDueAt();
    if (due === null) return;
    const wait = this.d.isConfigured() ? Math.max(0, due - this.now()) : IDLE_RECHECK_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, Math.max(wait, 50));
    this.timer.unref?.();
  }

  /** Proses satu item yang jatuh tempo. Mengembalikan true bila ada item yang diproses. */
  async runOnce(): Promise<boolean> {
    if (!this.d.isConfigured()) return false;
    const { queue } = this.d;
    const due = queue.nextDue(this.now());
    if (!due) return false;

    const rec = queue.markUploading(due.id)!;
    this.notify(rec);
    try {
      const data = await this.d.readFile(rec);
      const { fileId } = await this.d.uploader.upload({
        name: rec.name,
        data,
        sessionKey: this.d.sessionKey(rec),
      });
      this.notify(queue.markDone(rec.id, fileId));
      this.d.onNetwork?.(true);
      this.d.onSuccess?.();
      this.d.log?.(`upload #${rec.sessionNo} berhasil (${rec.name})`);
    } catch (err) {
      this.handleFailure(rec, err);
    }
    return true;
  }

  private handleFailure(rec: QueueRecord, err: unknown): void {
    const { queue } = this.d;
    const message = err instanceof Error ? err.message : String(err);

    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      this.fail(rec, 'File strip tidak ditemukan di disk');
      return;
    }

    const kind = err instanceof DriveError ? err.kind : 'transient';
    switch (kind) {
      case 'network': {
        // Tidak dihitung sebagai gagal: terus dicoba sampai internet kembali.
        const delay = backoffMs(rec.attempts, { ...NETWORK_BACKOFF, random: this.d.random });
        this.d.onNetwork?.(false);
        this.notify(queue.markRetry(rec.id, `No internet: ${message}`, this.now() + delay));
        this.d.log?.(`upload #${rec.sessionNo} tertunda (jaringan), coba lagi ${Math.round(delay / 1000)} dtk`);
        break;
      }
      case 'transient': {
        if (rec.attempts >= MAX_TRANSIENT_ATTEMPTS) {
          this.fail(rec, `Google error after ${rec.attempts} tries: ${message}`);
          break;
        }
        const delay = backoffMs(rec.attempts, { ...TRANSIENT_BACKOFF, random: this.d.random });
        this.notify(queue.markRetry(rec.id, message, this.now() + delay));
        this.d.log?.(`upload #${rec.sessionNo} gagal sementara (${message}), coba lagi ${Math.round(delay / 1000)} dtk`);
        break;
      }
      case 'auth':
        this.d.onAuthProblem?.(message);
        this.fail(rec, message);
        break;
      case 'permanent':
        this.d.onAuthProblem?.(message);
        this.fail(rec, message);
        break;
    }
  }

  private fail(rec: QueueRecord, message: string): void {
    this.notify(this.d.queue.markFailed(rec.id, message));
    this.d.log?.(`upload #${rec.sessionNo} GAGAL: ${message}`);
  }

  /**
   * Beri tahu pendengar status. Mutasi antrean SELALU dilakukan lebih dulu oleh pemanggil
   * (jangan menaruhnya sebagai argumen `onStatus?.(...)`: bila onStatus kosong, argumen tidak dievaluasi).
   */
  private notify(rec: QueueRecord | undefined): void {
    if (rec) this.d.onStatus?.(rec);
  }
}
