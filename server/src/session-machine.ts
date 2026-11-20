import type { SessionCfg, SessionState } from '../../shared/protocol';

/**
 * State machine sesi foto. Fungsi murni: (state, event) -> {state, effects}.
 * Waktu/IO dikerjakan oleh Controller lewat `effects`, jadi seluruh alur bisa dites tanpa timer sungguhan.
 *
 *   idle ─start─▶ ready ─▶ countdown ─▶ flash ─▶ between ─┬▶ countdown (slot berikutnya)
 *                                                          └▶ assembling ─▶ review ─┬─finish─▶ saving ─▶ saved ─▶ idle
 *                                                                                   └─startRetake─▶ retake_intro ─▶ countdown ...
 */

export type SessionEvent =
  | { type: 'start'; sessionNo: number; frameId: string; slotCount: number; cfg: SessionCfg }
  | { type: 'tick'; gen: number }
  | { type: 'flashEnd'; gen: number }
  | { type: 'shotSaved'; slot: number; rev: number }
  | { type: 'shotFailed'; slot: number }
  | { type: 'shotTimeout'; shotId: number }
  | { type: 'stripReady'; rev: number }
  | { type: 'stripFailed' }
  | { type: 'toggleRetake'; slot: number }
  | { type: 'startRetake' }
  | { type: 'finish' }
  | { type: 'savingStep'; step: number }
  | { type: 'savingDone'; online: boolean }
  | { type: 'savedTimeout'; gen: number }
  | { type: 'cancel' };

export type NoticeCode = 'SHOT_RETRY' | 'STRIP_RETRY' | 'CAMERA_ERROR';

export type Effect =
  | { kind: 'after'; ms: number; event: SessionEvent }
  | { kind: 'capture'; slot: number }
  | { kind: 'assemble' }
  | { kind: 'finalize' }
  | { kind: 'cancelled' }
  | { kind: 'notice'; code: NoticeCode };

export interface Result {
  state: SessionState;
  effects: Effect[];
}

/** Jeda setelah foto terakhir sebelum strip dirakit. */
export const LAST_PAUSE_SEC = 2;
/** Batas menunggu foto tersimpan di server setelah jepret. */
export const SHOT_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPTS = 3;

export function initialState(): SessionState {
  return {
    phase: 'idle',
    gen: 0,
    sessionNo: null,
    frameId: null,
    slotCount: 0,
    cfg: null,
    slotRevs: [],
    queue: [],
    current: null,
    count: 0,
    total: 0,
    isRetake: false,
    retaking: [],
    retakeSelection: [],
    pendingShot: false,
    shotId: 0,
    stripRev: 0,
    attempts: 0,
    savingStep: 0,
    savedOffline: false,
  };
}

const none = (state: SessionState): Result => ({ state, effects: [] });

const tick = (s: SessionState): Effect => ({
  kind: 'after',
  ms: 1000,
  event: { type: 'tick', gen: s.gen },
});

function resetToIdle(s: SessionState): SessionState {
  return { ...initialState(), gen: s.gen + 1, shotId: s.shotId };
}

function beginCountdown(s: SessionState, slot: number, queue: number[]): Result {
  const cfg = s.cfg!;
  const next: SessionState = {
    ...s,
    phase: 'countdown',
    gen: s.gen + 1,
    current: slot,
    queue,
    count: cfg.countdownSec,
    total: cfg.countdownSec,
    pendingShot: false,
  };
  return { state: next, effects: [tick(next)] };
}

function beginNextShot(s: SessionState): Result {
  const [slot, ...rest] = s.queue;
  if (slot === undefined) return beginAssembly(s);
  return beginCountdown({ ...s, attempts: 0 }, slot, rest);
}

function beginAssembly(s: SessionState): Result {
  const next: SessionState = {
    ...s,
    phase: 'assembling',
    gen: s.gen + 1,
    current: null,
    pendingShot: false,
    attempts: 0,
    count: 0,
    total: 0,
  };
  return { state: next, effects: [{ kind: 'assemble' }] };
}

function abort(s: SessionState): Result {
  return {
    state: resetToIdle(s),
    effects: [{ kind: 'cancelled' }, { kind: 'notice', code: 'CAMERA_ERROR' }],
  };
}

function onTick(s: SessionState): Result {
  switch (s.phase) {
    case 'ready':
    case 'retake_intro': {
      const count = s.count - 1;
      if (count <= 0) return beginNextShot({ ...s, count: 0 });
      const next = { ...s, count };
      return { state: next, effects: [tick(next)] };
    }
    case 'countdown': {
      const count = s.count - 1;
      if (count > 0) {
        const next = { ...s, count };
        return { state: next, effects: [tick(next)] };
      }
      // Waktu habis -> flash + perintah jepret
      const shotId = s.shotId + 1;
      const next: SessionState = {
        ...s,
        phase: 'flash',
        gen: s.gen + 1,
        count: 0,
        pendingShot: true,
        shotId,
      };
      return {
        state: next,
        effects: [
          { kind: 'capture', slot: s.current! },
          { kind: 'after', ms: s.cfg!.flashMs, event: { type: 'flashEnd', gen: next.gen } },
          { kind: 'after', ms: SHOT_TIMEOUT_MS, event: { type: 'shotTimeout', shotId } },
        ],
      };
    }
    case 'between': {
      const count = Math.max(0, s.count - 1);
      const next = { ...s, count };
      if (count > 0) return { state: next, effects: [tick(next)] };
      // Jeda habis. Kalau foto belum selesai tersimpan, tunggu `shotSaved`.
      if (next.pendingShot) return none(next);
      return advance(next);
    }
    default:
      return none(s);
  }
}

function advance(s: SessionState): Result {
  return s.queue.length > 0 ? beginNextShot(s) : beginAssembly(s);
}

function onShotFailed(s: SessionState, slot: number): Result {
  if ((s.phase !== 'flash' && s.phase !== 'between') || !s.pendingShot || slot !== s.current) {
    return none(s);
  }
  const attempts = s.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return abort(s);
  // Ulangi hitung mundur untuk slot yang sama.
  const r = beginCountdown({ ...s, attempts }, slot, s.queue);
  return { state: r.state, effects: [{ kind: 'notice', code: 'SHOT_RETRY' }, ...r.effects] };
}

export function transition(s: SessionState, e: SessionEvent): Result {
  switch (e.type) {
    case 'start': {
      if (s.phase !== 'idle' || e.slotCount < 1) return none(s);
      const next: SessionState = {
        ...initialState(),
        phase: 'ready',
        gen: s.gen + 1,
        shotId: s.shotId,
        sessionNo: e.sessionNo,
        frameId: e.frameId,
        slotCount: e.slotCount,
        cfg: e.cfg,
        slotRevs: Array.from({ length: e.slotCount }, () => 0),
        queue: Array.from({ length: e.slotCount }, (_, i) => i + 1),
        count: e.cfg.readySec,
        total: e.cfg.readySec,
      };
      return { state: next, effects: [tick(next)] };
    }

    case 'tick':
      return e.gen === s.gen ? onTick(s) : none(s);

    case 'flashEnd': {
      if (e.gen !== s.gen || s.phase !== 'flash') return none(s);
      const hasNext = s.queue.length > 0;
      const count = hasNext ? s.cfg!.pauseSec : LAST_PAUSE_SEC;
      const next: SessionState = { ...s, phase: 'between', gen: s.gen + 1, count, total: count };
      return { state: next, effects: [tick(next)] };
    }

    case 'shotSaved': {
      if (e.slot < 1 || e.slot > s.slotCount) return none(s);
      const slotRevs = s.slotRevs.slice();
      slotRevs[e.slot - 1] = e.rev;
      const next: SessionState = { ...s, slotRevs };
      const waiting = (s.phase === 'flash' || s.phase === 'between') && s.pendingShot && e.slot === s.current;
      if (!waiting) return none(next);
      const saved: SessionState = { ...next, pendingShot: false, attempts: 0 };
      if (saved.phase === 'between' && saved.count <= 0) return advance(saved);
      return none(saved);
    }

    case 'shotFailed':
      return onShotFailed(s, e.slot);

    case 'shotTimeout':
      return e.shotId === s.shotId && s.current !== null ? onShotFailed(s, s.current) : none(s);

    case 'stripReady': {
      if (s.phase !== 'assembling') return none(s);
      return none({
        ...s,
        phase: 'review',
        gen: s.gen + 1,
        stripRev: e.rev,
        retakeSelection: [],
        retaking: [],
        isRetake: false,
      });
    }

    case 'stripFailed': {
      if (s.phase !== 'assembling') return none(s);
      const attempts = s.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return abort(s);
      return {
        state: { ...s, attempts },
        effects: [{ kind: 'notice', code: 'STRIP_RETRY' }, { kind: 'assemble' }],
      };
    }

    case 'toggleRetake': {
      if (s.phase !== 'review' || e.slot < 1 || e.slot > s.slotCount) return none(s);
      const sel = s.retakeSelection.includes(e.slot)
        ? s.retakeSelection.filter((x) => x !== e.slot)
        : [...s.retakeSelection, e.slot].sort((a, b) => a - b);
      return none({ ...s, retakeSelection: sel });
    }

    case 'startRetake': {
      if (s.phase !== 'review' || s.retakeSelection.length === 0) return none(s);
      const next: SessionState = {
        ...s,
        phase: 'retake_intro',
        gen: s.gen + 1,
        isRetake: true,
        retaking: s.retakeSelection,
        queue: s.retakeSelection,
        retakeSelection: [],
        current: null,
        count: s.cfg!.retakeIntroSec,
        total: s.cfg!.retakeIntroSec,
        attempts: 0,
      };
      return { state: next, effects: [tick(next)] };
    }

    case 'finish': {
      // Tidak boleh selesai selagi masih ada slot yang dipilih untuk diulang.
      if (s.phase !== 'review' || s.retakeSelection.length > 0) return none(s);
      const next: SessionState = { ...s, phase: 'saving', gen: s.gen + 1, savingStep: 0 };
      return { state: next, effects: [{ kind: 'finalize' }] };
    }

    case 'savingStep':
      return s.phase === 'saving' ? none({ ...s, savingStep: e.step }) : none(s);

    case 'savingDone': {
      if (s.phase !== 'saving') return none(s);
      const next: SessionState = {
        ...s,
        phase: 'saved',
        gen: s.gen + 1,
        savedOffline: !e.online,
        savingStep: s.savingStep,
      };
      return {
        state: next,
        effects: [
          { kind: 'after', ms: s.cfg!.savedSec * 1000, event: { type: 'savedTimeout', gen: next.gen } },
        ],
      };
    }

    case 'savedTimeout':
      return e.gen === s.gen && s.phase === 'saved' ? none(resetToIdle(s)) : none(s);

    case 'cancel': {
      if (s.phase === 'idle' || s.phase === 'saving' || s.phase === 'saved') return none(s);
      return { state: resetToIdle(s), effects: [{ kind: 'cancelled' }] };
    }
  }
}
