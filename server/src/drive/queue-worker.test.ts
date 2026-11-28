import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, DriveError, MAX_TRANSIENT_ATTEMPTS, NETWORK_BACKOFF, TRANSIENT_BACKOFF } from './errors';
import { UploadQueue } from './queue';
import { UploadWorker, type UploadJob, type Uploader } from './worker';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-queue-'));
  file = path.join(dir, 'upload-queue.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

class Clock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

type Step = { ok: string } | { err: DriveError | Error };

/** Uploader tiruan: tiap panggilan mengambil satu langkah dari skrip (langkah terakhir diulang). */
class FakeUploader implements Uploader {
  calls: UploadJob[] = [];
  constructor(private script: Step[]) {}
  async upload(job: UploadJob) {
    this.calls.push(job);
    const step = this.script.length > 1 ? this.script.shift()! : this.script[0]!;
    if ('err' in step) throw step.err;
    return { fileId: step.ok };
  }
}

function setup(script: Step[], opts: { configured?: boolean } = {}) {
  const clock = new Clock();
  const queue = new UploadQueue(file, clock.now);
  const uploader = new FakeUploader(script);
  const events = { network: [] as boolean[], auth: [] as string[], statuses: [] as string[] };
  const worker = new UploadWorker({
    queue,
    uploader,
    isConfigured: () => opts.configured ?? true,
    readFile: () => Buffer.from('png-bytes'),
    sessionKey: (r) => `key-${r.sessionNo}`,
    now: clock.now,
    random: () => 0.5, // jitter nol: waktu backoff bisa dihitung pasti
    onNetwork: (ok) => events.network.push(ok),
    onAuthProblem: (m) => events.auth.push(m),
    onStatus: (r) => events.statuses.push(`${r.sessionNo}:${r.status}`),
  });
  return { clock, queue, uploader, worker, events };
}

const network = () => new DriveError('network', 'fetch failed');
const transient = (status = 503) => new DriveError('transient', `Drive upload: ${status}`, status);

describe('backoff', () => {
  it('berlipat dua tiap percobaan dan berhenti di batas atas', () => {
    const p = { ...NETWORK_BACKOFF, random: () => 0.5 };
    expect([1, 2, 3, 4, 5, 6, 10].map((n) => backoffMs(n, p))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    const t = { ...TRANSIENT_BACKOFF, random: () => 0.5 };
    expect([1, 2, 3, 7, 8].map((n) => backoffMs(n, t))).toEqual([5000, 10000, 20000, 300000, 300000]);
  });

  it('jitter menggeser maksimal +/-20%', () => {
    const base = { baseMs: 10_000, capMs: 10_000 };
    expect(backoffMs(1, { ...base, random: () => 0 })).toBe(8000);
    expect(backoffMs(1, { ...base, random: () => 1 })).toBe(12000);
  });
});

describe('antrean tersimpan di disk', () => {
  it('bertahan setelah server restart (instance baru membaca file yang sama)', () => {
    const a = new UploadQueue(file);
    a.enqueue(1, 'PHOTO #001.png', 100);
    a.enqueue(2, 'PHOTO #002.png', 200);
    const b = new UploadQueue(file);
    expect(b.list().map((i) => [i.sessionNo, i.status, i.file])).toEqual([
      [2, 'queued', 'PHOTO #002.png'],
      [1, 'queued', 'PHOTO #001.png'],
    ]);
  });

  it('enqueue idempoten per sesi', () => {
    const q = new UploadQueue(file);
    const first = q.enqueue(7, 'PHOTO #007.png', 1);
    expect(q.enqueue(7, 'PHOTO #007.png', 1).id).toBe(first.id);
    expect(q.summary().queued).toBe(1);
  });

  it('item "uploading" yang tertinggal saat server mati kembali ke "queued"', () => {
    const clock = new Clock();
    const a = new UploadQueue(file, clock.now);
    const rec = a.enqueue(3, 'PHOTO #003.png', 10);
    a.markUploading(rec.id);
    expect(a.summary().uploading).toBe(1);

    const b = new UploadQueue(file, clock.now); // restart
    expect(b.summary()).toMatchObject({ queued: 1, uploading: 0 });
    expect(b.nextDue(clock.now())?.sessionNo).toBe(3);
  });

  it('status gagal dan jadwal retry ikut tersimpan', () => {
    const clock = new Clock();
    const a = new UploadQueue(file, clock.now);
    const r1 = a.enqueue(1, 'a', 1);
    const r2 = a.enqueue(2, 'b', 1);
    a.markFailed(r1.id, 'folder hilang');
    a.markRetry(r2.id, 'No internet', clock.now() + 60_000);
    const b = new UploadQueue(file, clock.now);
    expect(b.summary()).toMatchObject({ failed: 1, queued: 1 });
    expect(b.nextDue(clock.now())).toBeUndefined(); // belum waktunya
    expect(b.earliestDueAt()).toBe(clock.now() + 60_000);
  });

  it('file antrean rusak -> mulai dari kosong tanpa crash', () => {
    fs.writeFileSync(file, '{ rusak');
    expect(new UploadQueue(file).summary()).toEqual({ queued: 0, uploading: 0, done: 0, failed: 0 });
  });

  it('record rusak dibersihkan dan status tak dikenal menjadi "queued"', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'a',
            sessionNo: 1,
            name: 'PHOTO #001.png',
            sizeBytes: -5,
            status: 'aneh',
            attempts: -3,
            progress: 9,
            createdAt: 5,
            nextAttemptAt: 6,
          },
          { id: 'b', sessionNo: 2, name: 'PHOTO #002.png', status: 'queued' },
          { id: 'c', name: 'tanpa nomor', status: 'queued' },
          null,
        ],
      }),
    );
    const q = new UploadQueue(file);
    expect(q.summary()).toEqual({ queued: 2, uploading: 0, done: 0, failed: 0 });
    expect(q.list().map((i) => [i.sessionNo, i.status, i.attempts, i.progress, i.sizeBytes])).toEqual([
      [2, 'queued', 0, 0, 0],
      [1, 'queued', 0, 1, 0],
    ]);
  });

  it('tidak meninggalkan file .tmp', () => {
    new UploadQueue(file).enqueue(1, 'a', 1);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('worker: berhasil', () => {
  it('mengupload item, mencatat file id, dan mengirim kunci sesi + nama file', async () => {
    const { queue, worker, uploader, events } = setup([{ ok: 'drive-1' }]);
    queue.enqueue(42, 'PHOTO #042.png', 9);

    expect(await worker.runOnce()).toBe(true);
    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]).toMatchObject({ name: 'PHOTO #042.png', sessionKey: 'key-42' });
    expect(uploader.calls[0]!.data.toString()).toBe('png-bytes');
    expect(queue.list()[0]).toMatchObject({ status: 'done', progress: 1 });
    expect(events.network).toEqual([true]);
    expect(events.statuses).toEqual(['42:uploading', '42:done']);
  });

  it('memproses satu per satu, yang tertua dulu; false bila tidak ada yang jatuh tempo', async () => {
    const { queue, worker, uploader, clock } = setup([{ ok: 'x' }]);
    queue.enqueue(1, 'PHOTO #001.png', 1);
    clock.advance(10);
    queue.enqueue(2, 'PHOTO #002.png', 1);

    await worker.runOnce();
    expect(uploader.calls.map((c) => c.name)).toEqual(['PHOTO #001.png']);
    await worker.runOnce();
    expect(uploader.calls.map((c) => c.name)).toEqual(['PHOTO #001.png', 'PHOTO #002.png']);
    expect(await worker.runOnce()).toBe(false);
  });

  it('tidak berbuat apa-apa bila Drive belum dikonfigurasi (item tetap menunggu)', async () => {
    const { queue, worker, uploader } = setup([{ ok: 'x' }], { configured: false });
    queue.enqueue(1, 'a', 1);
    expect(await worker.runOnce()).toBe(false);
    expect(uploader.calls).toHaveLength(0);
    expect(queue.summary().queued).toBe(1);
  });
});

describe('worker: retry dengan exponential backoff', () => {
  it('internet mati: tetap "queued", jeda 2s,4s,8s,... maks 30s, tidak pernah "failed"', async () => {
    const { queue, worker, clock, events } = setup([{ err: network() }]);
    queue.enqueue(1, 'a', 1);

    const waits: number[] = [];
    for (let i = 0; i < 12; i++) {
      expect(await worker.runOnce()).toBe(true);
      const it = queue.list()[0]!;
      expect(it.status).toBe('queued');
      waits.push(it.nextAttemptAt! - clock.now());
      clock.advance(it.nextAttemptAt! - clock.now());
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]);
    expect(queue.summary().failed).toBe(0);
    expect(events.network.every((ok) => ok === false)).toBe(true);
  });

  it('belum jatuh tempo -> tidak dicoba; setelah waktunya dicoba lagi; berhasil begitu internet kembali', async () => {
    const { queue, worker, clock, uploader, events } = setup([{ err: network() }, { ok: 'drive-9' }]);
    queue.enqueue(1, 'a', 1);

    await worker.runOnce(); // gagal
    expect(await worker.runOnce()).toBe(false); // masih dalam masa tunggu
    expect(uploader.calls).toHaveLength(1);

    clock.advance(2000);
    await worker.runOnce(); // internet kembali
    expect(queue.list()[0]).toMatchObject({ status: 'done' });
    expect(events.network).toEqual([false, true]);
  });

  it('expedite(): internet kembali -> semua yang menunggu backoff boleh dicoba sekarang', async () => {
    const { queue, worker, uploader } = setup([{ err: network() }, { ok: 'x' }]);
    queue.enqueue(1, 'a', 1);
    await worker.runOnce();
    expect(await worker.runOnce()).toBe(false);
    queue.expedite();
    expect(await worker.runOnce()).toBe(true);
    expect(uploader.calls).toHaveLength(2);
  });

  it(`error Google sementara (5xx): backoff lalu "failed" setelah ${MAX_TRANSIENT_ATTEMPTS} percobaan`, async () => {
    const { queue, worker, clock, uploader } = setup([{ err: transient(503) }]);
    queue.enqueue(1, 'a', 1);

    for (let i = 1; i <= MAX_TRANSIENT_ATTEMPTS; i++) {
      await worker.runOnce();
      const it = queue.list()[0]!;
      if (i < MAX_TRANSIENT_ATTEMPTS) {
        expect(it.status).toBe('queued');
        clock.advance(it.nextAttemptAt! - clock.now());
      }
    }
    expect(queue.list()[0]).toMatchObject({ status: 'failed', attempts: MAX_TRANSIENT_ATTEMPTS });
    expect(queue.list()[0]!.error).toMatch(/after 8 tries/);
    expect(uploader.calls).toHaveLength(MAX_TRANSIENT_ATTEMPTS);
    clock.advance(10 * 60_000);
    expect(await worker.runOnce()).toBe(false); // yang gagal tidak dicoba otomatis lagi
  });

  it('error permanen (mis. folder tidak ada): langsung "failed" dan melapor ke status Drive', async () => {
    const { queue, worker, events } = setup([{ err: new DriveError('permanent', 'Folder not found', 404) }]);
    queue.enqueue(1, 'a', 1);
    await worker.runOnce();
    expect(queue.list()[0]).toMatchObject({ status: 'failed', error: 'Folder not found' });
    expect(events.auth).toEqual(['Folder not found']);
  });

  it('token dicabut (auth): langsung "failed" dan melapor', async () => {
    const { queue, worker, events } = setup([{ err: new DriveError('auth', 'Google sign-in expired', 400) }]);
    queue.enqueue(1, 'a', 1);
    await worker.runOnce();
    expect(queue.summary().failed).toBe(1);
    expect(events.auth).toHaveLength(1);
  });

  it('file strip hilang dari disk: "failed" dengan pesan jelas', async () => {
    const clock = new Clock();
    const queue = new UploadQueue(file, clock.now);
    const worker = new UploadWorker({
      queue,
      uploader: new FakeUploader([{ ok: 'x' }]),
      isConfigured: () => true,
      readFile: () => {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      },
      sessionKey: () => 'k',
      now: clock.now,
    });
    queue.enqueue(1, 'a', 1);
    await worker.runOnce();
    expect(queue.list()[0]).toMatchObject({ status: 'failed' });
    expect(queue.list()[0]!.error).toMatch(/not found|tidak ditemukan/i);
  });

  it('RETRY dari operator menghidupkan lagi item yang gagal', async () => {
    const { queue, worker } = setup([{ err: new DriveError('permanent', 'boom', 403) }, { ok: 'ok-1' }]);
    const rec = queue.enqueue(1, 'a', 1);
    await worker.runOnce();
    expect(queue.summary().failed).toBe(1);

    expect(queue.retry(rec.id)).toBe(1);
    expect(queue.list()[0]).toMatchObject({ status: 'queued', attempts: 0, error: undefined });
    await worker.runOnce();
    expect(queue.list()[0]).toMatchObject({ status: 'done' });
  });

  it('RETRY tanpa id mengulang semua yang gagal, tidak menyentuh yang lain', async () => {
    const q = new UploadQueue(file);
    const a = q.enqueue(1, 'a', 1);
    const b = q.enqueue(2, 'b', 1);
    const c = q.enqueue(3, 'c', 1);
    q.markFailed(a.id, 'x');
    q.markFailed(b.id, 'y');
    q.markDone(c.id, 'd');
    expect(q.retry()).toBe(2);
    expect(q.summary()).toEqual({ queued: 2, uploading: 0, done: 1, failed: 0 });
  });
});

describe('worker: tidak memblok', () => {
  it('kick() langsung kembali walau upload masih berjalan; sesi berikutnya bisa masuk antrean saat itu', async () => {
    const clock = new Clock();
    const queue = new UploadQueue(file, clock.now);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const worker = new UploadWorker({
      queue,
      uploader: {
        upload: async () => {
          await gate;
          return { fileId: 'slow' };
        },
      },
      isConfigured: () => true,
      readFile: () => Buffer.from('x'),
      sessionKey: () => 'k',
      now: clock.now,
    });
    worker.start();

    queue.enqueue(1, 'a', 1);
    const t0 = Date.now();
    worker.kick(); // harus kembali segera
    expect(Date.now() - t0).toBeLessThan(50);
    await vi.waitFor(() => expect(queue.summary().uploading).toBe(1));

    // sementara upload macet, sesi baru tetap bisa dimasukkan
    queue.enqueue(2, 'b', 1);
    expect(queue.summary()).toMatchObject({ uploading: 1, queued: 1 });

    release();
    await vi.waitFor(() => expect(queue.summary().done).toBe(2));
    worker.stop();
  });

  it('timer menjadwalkan percobaan ulang sendiri setelah backoff', async () => {
    vi.useFakeTimers();
    try {
      // jam bawaan (Date.now) ikut dipalsukan vitest, jadi timer dan "now" sejalan
      const queue = new UploadQueue(file);
      queue.enqueue(1, 'a', 1);
      const w = new UploadWorker({
        queue,
        uploader: new FakeUploader([{ err: network() }, { ok: 'later' }]),
        isConfigured: () => true,
        readFile: () => Buffer.from('x'),
        sessionKey: () => 'k',
        random: () => 0.5,
      });
      w.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(queue.list()[0]).toMatchObject({ status: 'queued' });
      await vi.advanceTimersByTimeAsync(2500);
      expect(queue.list()[0]).toMatchObject({ status: 'done' });
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
