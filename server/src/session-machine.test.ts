import { describe, expect, it } from 'vitest';
import type { SessionCfg, SessionState } from '../../shared/protocol';
import {
  initialState,
  LAST_PAUSE_SEC,
  MAX_ATTEMPTS,
  transition,
  type Effect,
  type SessionEvent,
} from './session-machine';

const cfg: SessionCfg = {
  readySec: 3,
  countdownSec: 5,
  pauseSec: 4,
  flashMs: 700,
  retakeIntroSec: 3,
  savedSec: 8,
  flashEffect: true,
};

/** Driver kecil: menjalankan event dan mengumpulkan effects; timer 'after' disimpan manual. */
class Harness {
  state: SessionState = initialState();
  effects: Effect[] = [];
  pending: Extract<Effect, { kind: 'after' }>[] = [];

  send(e: SessionEvent) {
    const r = transition(this.state, e);
    this.state = r.state;
    for (const ef of r.effects) {
      this.effects.push(ef);
      if (ef.kind === 'after') this.pending.push(ef);
    }
    return r;
  }

  /** Jalankan semua timer 'after' yang belum basi (event dikirim apa adanya). */
  fire(filter?: (e: SessionEvent) => boolean) {
    const due = this.pending.filter((p) => !filter || filter(p.event));
    this.pending = this.pending.filter((p) => !due.includes(p));
    for (const p of due) this.send(p.event);
  }

  /** Jalankan tick berulang sampai fase berubah dari `phase`. */
  tickUntilLeave(phase: SessionState['phase']) {
    let guard = 100;
    while (this.state.phase === phase && guard-- > 0) {
      const ticks = this.pending.filter((p) => p.event.type === 'tick');
      expect(ticks.length, `tick tertunda untuk fase ${phase}`).toBeGreaterThan(0);
      this.pending = this.pending.filter((p) => p.event.type !== 'tick');
      for (const t of ticks) this.send(t.event);
    }
  }

  capturedSlots() {
    return this.effects.filter((e) => e.kind === 'capture').map((e) => (e as { slot: number }).slot);
  }

  start(slotCount = 3) {
    this.send({ type: 'start', sessionNo: 42, frameId: 'sunset', slotCount, cfg });
  }

  /** Foto satu slot: countdown -> flash -> (foto tersimpan) -> flashEnd. */
  shoot(slot: number, rev: number) {
    this.tickUntilLeave('countdown');
    expect(this.state.phase).toBe('flash');
    expect(this.state.current).toBe(slot);
    this.send({ type: 'shotSaved', slot, rev });
    this.fire((e) => e.type === 'flashEnd');
    expect(this.state.phase).toBe('between');
  }
}

/** Jalankan sesi sampai fase review dengan 3 foto. */
function reachReview(h = new Harness()) {
  h.start();
  h.tickUntilLeave('ready');
  h.shoot(1, 101);
  h.tickUntilLeave('between');
  h.shoot(2, 102);
  h.tickUntilLeave('between');
  h.shoot(3, 103);
  h.tickUntilLeave('between');
  expect(h.state.phase).toBe('assembling');
  h.send({ type: 'stripReady', rev: 200 });
  expect(h.state.phase).toBe('review');
  return h;
}

describe('alur sesi normal', () => {
  it('mulai dari idle ke ready dengan antrean 3 slot', () => {
    const h = new Harness();
    h.start();
    expect(h.state).toMatchObject({
      phase: 'ready',
      sessionNo: 42,
      queue: [1, 2, 3],
      slotRevs: [0, 0, 0],
      count: 3,
    });
  });

  it('hanya bisa start dari idle', () => {
    const h = new Harness();
    h.start();
    const before = h.state;
    h.send({ type: 'start', sessionNo: 43, frameId: 'x', slotCount: 3, cfg });
    expect(h.state).toBe(before);
  });

  it('hitung mundur 5..1 lalu flash + perintah capture untuk slot yang benar', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    expect(h.state).toMatchObject({ phase: 'countdown', current: 1, count: 5, queue: [2, 3] });

    h.tickUntilLeave('countdown');
    expect(h.state.phase).toBe('flash');
    expect(h.state.pendingShot).toBe(true);
    expect(h.capturedSlots()).toEqual([1]);
  });

  it('menampilkan angka 5,4,3,2,1 sebelum flash', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    const counts: number[] = [];
    while (h.state.phase === 'countdown') {
      counts.push(h.state.count);
      const t = h.pending.filter((p) => p.event.type === 'tick');
      h.pending = h.pending.filter((p) => p.event.type !== 'tick');
      for (const x of t) h.send(x.event);
    }
    expect(counts).toEqual([5, 4, 3, 2, 1]);
  });

  it('3 foto -> assembling -> review, tiap slot dicatat revisinya', () => {
    const h = reachReview();
    expect(h.state.slotRevs).toEqual([101, 102, 103]);
    expect(h.state.stripRev).toBe(200);
    expect(h.capturedSlots()).toEqual([1, 2, 3]);
  });

  it('jeda setelah foto terakhir memakai LAST_PAUSE_SEC, bukan pauseSec', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.shoot(1, 1);
    expect(h.state.count).toBe(cfg.pauseSec);
    h.tickUntilLeave('between');
    h.shoot(2, 2);
    h.tickUntilLeave('between');
    h.shoot(3, 3);
    expect(h.state.count).toBe(LAST_PAUSE_SEC);
  });

  it('menunggu foto tersimpan bila jeda habis lebih dulu', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.tickUntilLeave('countdown');
    h.fire((e) => e.type === 'flashEnd'); // foto belum tersimpan
    expect(h.state.phase).toBe('between');
    expect(h.state.pendingShot).toBe(true);
    for (let i = 0; i < cfg.pauseSec; i++) {
      const t = h.pending.filter((p) => p.event.type === 'tick');
      h.pending = h.pending.filter((p) => p.event.type !== 'tick');
      for (const x of t) h.send(x.event);
    }
    expect(h.state).toMatchObject({ phase: 'between', count: 0, pendingShot: true });
    h.send({ type: 'shotSaved', slot: 1, rev: 9 });
    expect(h.state).toMatchObject({ phase: 'countdown', current: 2 });
  });
});

describe('retake', () => {
  it('toggle slot (boleh lebih dari satu) lalu hanya slot terpilih yang difoto ulang', () => {
    const h = reachReview();
    h.send({ type: 'toggleRetake', slot: 3 });
    h.send({ type: 'toggleRetake', slot: 1 });
    expect(h.state.retakeSelection).toEqual([1, 3]);
    h.send({ type: 'toggleRetake', slot: 3 });
    h.send({ type: 'toggleRetake', slot: 3 });
    expect(h.state.retakeSelection).toEqual([1, 3]);

    h.effects = [];
    h.send({ type: 'startRetake' });
    expect(h.state).toMatchObject({ phase: 'retake_intro', isRetake: true, retaking: [1, 3], queue: [1, 3] });
    expect(h.state.retakeSelection).toEqual([]);

    h.tickUntilLeave('retake_intro');
    h.shoot(1, 301);
    h.tickUntilLeave('between');
    h.shoot(3, 303);
    h.tickUntilLeave('between');
    expect(h.state.phase).toBe('assembling');
    expect(h.capturedSlots()).toEqual([1, 3]); // slot 2 tidak disentuh
    expect(h.state.slotRevs).toEqual([301, 102, 303]);

    h.send({ type: 'stripReady', rev: 400 });
    expect(h.state).toMatchObject({ phase: 'review', stripRev: 400, isRetake: false, retaking: [] });
  });

  it('startRetake tanpa pilihan diabaikan; slot di luar rentang diabaikan', () => {
    const h = reachReview();
    const before = h.state;
    h.send({ type: 'startRetake' });
    expect(h.state).toBe(before);
    h.send({ type: 'toggleRetake', slot: 9 });
    expect(h.state.retakeSelection).toEqual([]);
  });

  it('tidak bisa SELESAI selagi masih ada slot terpilih', () => {
    const h = reachReview();
    h.send({ type: 'toggleRetake', slot: 2 });
    h.send({ type: 'finish' });
    expect(h.state.phase).toBe('review');
    h.send({ type: 'toggleRetake', slot: 2 });
    h.send({ type: 'finish' });
    expect(h.state.phase).toBe('saving');
  });
});

describe('selesai & menyimpan', () => {
  it('finish -> saving (+effect finalize) -> saved -> idle otomatis', () => {
    const h = reachReview();
    h.effects = [];
    h.send({ type: 'finish' });
    expect(h.state.phase).toBe('saving');
    expect(h.effects.some((e) => e.kind === 'finalize')).toBe(true);

    h.send({ type: 'savingStep', step: 2 });
    expect(h.state.savingStep).toBe(2);

    h.send({ type: 'savingDone', online: true });
    expect(h.state).toMatchObject({ phase: 'saved', savedOffline: false });
    h.fire((e) => e.type === 'savedTimeout');
    expect(h.state).toMatchObject({ phase: 'idle', sessionNo: null });
  });

  it('tanpa internet -> saved dengan savedOffline (layar G9)', () => {
    const h = reachReview();
    h.send({ type: 'finish' });
    h.send({ type: 'savingDone', online: false });
    expect(h.state).toMatchObject({ phase: 'saved', savedOffline: true });
  });

  it('bisa mulai sesi baru sesudah kembali ke idle', () => {
    const h = reachReview();
    h.send({ type: 'finish' });
    h.send({ type: 'savingDone', online: true });
    h.fire((e) => e.type === 'savedTimeout');
    h.send({ type: 'start', sessionNo: 43, frameId: 'sunset', slotCount: 3, cfg });
    expect(h.state).toMatchObject({ phase: 'ready', sessionNo: 43 });
  });

  it('cancel tidak berlaku saat saving/saved/idle', () => {
    const h = reachReview();
    h.send({ type: 'finish' });
    h.send({ type: 'cancel' });
    expect(h.state.phase).toBe('saving');
    h.send({ type: 'savingDone', online: true });
    h.send({ type: 'cancel' });
    expect(h.state.phase).toBe('saved');
  });
});

describe('batal, timer basi, dan kegagalan', () => {
  it('cancel di tengah sesi kembali ke idle + effect cancelled; timer lama tidak berefek', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    const stale = h.pending.slice();
    h.effects = [];
    h.send({ type: 'cancel' });
    expect(h.state.phase).toBe('idle');
    expect(h.effects.some((e) => e.kind === 'cancelled')).toBe(true);

    h.start(); // sesi baru
    const phaseAfterStart = h.state;
    for (const p of stale) h.send(p.event); // tick dari sesi lama (gen basi)
    expect(h.state).toEqual(phaseAfterStart);
  });

  it('tick dengan gen basi diabaikan', () => {
    const h = new Harness();
    h.start();
    const before = h.state;
    h.send({ type: 'tick', gen: before.gen - 1 });
    expect(h.state).toBe(before);
  });

  it('foto gagal: hitung mundur diulang untuk slot yang sama + notice', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.tickUntilLeave('countdown');
    h.effects = [];
    h.send({ type: 'shotFailed', slot: 1 });
    expect(h.state).toMatchObject({ phase: 'countdown', current: 1, count: cfg.countdownSec, attempts: 1 });
    expect(h.state.queue).toEqual([2, 3]);
    expect(h.effects.some((e) => e.kind === 'notice' && e.code === 'SHOT_RETRY')).toBe(true);
  });

  it(`gagal ${MAX_ATTEMPTS}x berturut-turut membatalkan sesi`, () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      h.tickUntilLeave('countdown');
      h.send({ type: 'shotFailed', slot: 1 });
    }
    expect(h.state.phase).toBe('idle');
    expect(h.effects.some((e) => e.kind === 'cancelled')).toBe(true);
    expect(h.effects.some((e) => e.kind === 'notice' && e.code === 'CAMERA_ERROR')).toBe(true);
  });

  it('shotTimeout hanya berlaku untuk jepretan yang sama', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.tickUntilLeave('countdown');
    const shotId = h.state.shotId;
    h.send({ type: 'shotSaved', slot: 1, rev: 5 });
    const before = h.state;
    h.send({ type: 'shotTimeout', shotId });
    expect(h.state).toBe(before); // sudah tersimpan, timeout tidak berefek
  });

  it('shotFailed untuk slot lain diabaikan', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.tickUntilLeave('countdown');
    const before = h.state;
    h.send({ type: 'shotFailed', slot: 2 });
    expect(h.state).toBe(before);
  });

  it('perakitan strip gagal: coba lagi, lalu batal setelah MAX_ATTEMPTS', () => {
    const h = new Harness();
    h.start();
    h.tickUntilLeave('ready');
    h.shoot(1, 1);
    h.tickUntilLeave('between');
    h.shoot(2, 2);
    h.tickUntilLeave('between');
    h.shoot(3, 3);
    h.tickUntilLeave('between');
    expect(h.state.phase).toBe('assembling');

    h.effects = [];
    h.send({ type: 'stripFailed' });
    expect(h.state.phase).toBe('assembling');
    expect(h.effects.some((e) => e.kind === 'assemble')).toBe(true);
    for (let i = 1; i < MAX_ATTEMPTS; i++) h.send({ type: 'stripFailed' });
    expect(h.state.phase).toBe('idle');
  });
});
