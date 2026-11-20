import type { WebSocket } from 'ws';
import {
  SAVING_STEPS,
  type ClientMsg,
  type ClientRole,
  type DriveInfo,
  type FrameInfo,
  type Notice,
  type PublicState,
  type QueueSummary,
  type ServerMsg,
  type SessionCfg,
  type SessionState,
  type Settings,
} from '../../shared/protocol';
import { scanFrames } from './frames';
import { initialState, transition, type Effect, type NoticeCode, type SessionEvent } from './session-machine';
import type { SessionStore } from './session-store';
import type { SettingsStore } from './settings';

const NOTICE_TEXT: Record<Notice['code'], string> = {
  SHOT_RETRY: 'Photo failed, counting down again.',
  STRIP_RETRY: 'Building the strip failed, trying again.',
  CAMERA_ERROR: 'Camera problem: session cancelled. Check the webcam and the guest display window.',
  NO_BOOTH: 'Open /booth on the guest monitor first.',
  NO_FRAME: 'No frame found. Put a PNG + JSON in the frames/ folder.',
  BAD_STATE: 'That action is not available right now.',
};

/** Pengaturan tetap (tidak ada di panel Settings). */
const FIXED = { readySec: 3, flashMs: 700, retakeIntroSec: 3, savedSec: 8 } as const;
/** Lama minimal layar "SAVING..." supaya tidak berkedip. */
const SAVING_STEP_MS = 500;

export interface ControllerDeps {
  store: SessionStore;
  settings: SettingsStore;
  framesDir: string;
  isOnline: () => boolean;
  log?: (msg: string) => void;
  /** Dipanggil setelah sesi selesai disimpan lokal. Fase 2: masukkan ke antrean upload. */
  onFinalized?: (no: number) => void;
  drive?: () => DriveInfo;
  queueSummary?: () => QueueSummary;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Menghubungkan state machine murni dengan dunia nyata: timer, WebSocket, disk.
 * Semua perubahan state lewat `dispatch()`.
 */
export class Controller {
  private state = initialState();
  private readonly clients = new Map<WebSocket, ClientRole | null>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private cameraId: string | null = null;
  private boothCamera: PublicState['boothCamera'] = null;
  private notice: Notice | null = null;
  private noticeSeq = 0;
  private lastRev = 0;
  private frameCache: { at: number; frames: FrameInfo[] } | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  // ---------- frame & settings ----------

  getFrames(): FrameInfo[] {
    const now = Date.now();
    if (!this.frameCache || now - this.frameCache.at > 1000) {
      const { frames, skipped } = scanFrames(this.deps.framesDir);
      for (const s of skipped) this.deps.log?.(`frame dilewati: ${s.file} (${s.reason})`);
      this.frameCache = { at: now, frames };
    }
    return this.frameCache.frames;
  }

  private resolveFrame(id: string | null): FrameInfo | null {
    const frames = this.getFrames();
    return frames.find((f) => f.id === id) ?? frames[0] ?? null;
  }

  updateSettings(patch: unknown): Settings {
    const next = this.deps.settings.update(patch);
    this.broadcastState();
    return next;
  }

  // ---------- state publik ----------

  publicState(): PublicState {
    const settings = this.deps.settings.get();
    const frame = this.resolveFrame(this.state.frameId ?? settings.frameId);
    return {
      ...this.state,
      nextNo: this.deps.store.peekNext(),
      online: this.deps.isOnline(),
      booth: this.boothCount() > 0,
      boothCamera: this.boothCamera,
      cameraId: this.cameraId,
      settings,
      frame,
      drive: this.deps.drive?.() ?? { configured: false, status: 'off' },
      uploads: this.deps.queueSummary?.() ?? { queued: 0, uploading: 0, done: 0, failed: 0 },
      notice: this.notice,
    };
  }

  private boothCount(): number {
    let n = 0;
    for (const role of this.clients.values()) if (role === 'booth') n++;
    return n;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendToBooths(msg: ServerMsg): void {
    for (const [ws, role] of this.clients) if (role === 'booth') this.send(ws, msg);
  }

  broadcastState(): void {
    const msg: ServerMsg = { type: 'state', state: this.publicState() };
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  private setNotice(code: Notice['code']): void {
    this.notice = { id: ++this.noticeSeq, code, text: NOTICE_TEXT[code] };
  }

  // ---------- state machine ----------

  dispatch(event: SessionEvent): void {
    const prev = this.state;
    const result = transition(prev, event);
    this.state = result.state;
    for (const effect of result.effects) this.runEffect(effect, prev);
    this.broadcastState();
  }

  private runEffect(effect: Effect, prev: SessionState): void {
    switch (effect.kind) {
      case 'after': {
        const t = setTimeout(() => {
          this.timers.delete(t);
          this.dispatch(effect.event);
        }, effect.ms);
        this.timers.add(t);
        break;
      }
      case 'capture':
        this.sendToBooths({ type: 'capture', sessionNo: this.state.sessionNo!, slot: effect.slot });
        break;
      case 'assemble':
        this.sendToBooths({
          type: 'assemble',
          sessionNo: this.state.sessionNo!,
          frameId: this.state.frameId!,
          slotRevs: this.state.slotRevs,
        });
        break;
      case 'finalize':
        void this.finalize(this.state.sessionNo!);
        break;
      case 'cancelled':
        if (prev.sessionNo !== null) {
          this.deps.store.updateMeta(prev.sessionNo, (m) => ({
            ...m,
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
          }));
          this.deps.log?.(`sesi #${prev.sessionNo} dibatalkan`);
        }
        break;
      case 'notice':
        this.setNotice(effect.code satisfies NoticeCode);
        break;
    }
  }

  private async finalize(no: number): Promise<void> {
    const { store } = this.deps;
    try {
      this.dispatch({ type: 'savingStep', step: 1 });
      await sleep(SAVING_STEP_MS);
      store.updateMeta(no, (m) => ({ ...m, status: 'finalized', finishedAt: new Date().toISOString() }));
      this.dispatch({ type: 'savingStep', step: 2 });
      await sleep(SAVING_STEP_MS);
      this.deps.onFinalized?.(no);
      this.dispatch({ type: 'savingStep', step: SAVING_STEPS });
      await sleep(SAVING_STEP_MS);
      this.deps.log?.(`sesi #${no} tersimpan lokal`);
    } catch (err) {
      this.deps.log?.(`gagal menyimpan sesi #${no}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.dispatch({ type: 'savingDone', online: this.deps.isOnline() });
  }

  /** Dipanggil saat status koneksi internet berubah. */
  onOnlineChange(): void {
    this.broadcastState();
  }

  /** Dipanggil saat antrean upload/Drive berubah (Fase 2). */
  onExternalChange(): void {
    this.broadcastState();
  }

  // ---------- perintah operator ----------

  /** Mulai sesi baru. Mengembalikan kode error bila ditolak. */
  startSession(): Notice['code'] | null {
    if (this.state.phase !== 'idle') return 'BAD_STATE';
    if (this.boothCount() === 0) return 'NO_BOOTH';
    const frame = this.resolveFrame(this.deps.settings.get().frameId);
    if (!frame) return 'NO_FRAME';

    const s = this.deps.settings.get();
    const cfg: SessionCfg = {
      ...FIXED,
      countdownSec: s.countdownSec,
      pauseSec: s.pauseSec,
      flashEffect: s.flash,
    };
    const no = this.deps.store.reserveNext();
    this.deps.store.writeMeta({
      no,
      createdAt: new Date().toISOString(),
      frameId: frame.id,
      slotCount: frame.slots.length,
      status: 'in_progress',
      slotRevs: frame.slots.map(() => 0),
      stripRev: 0,
      retakes: 0,
    });
    this.notice = null;
    this.deps.log?.(`sesi #${no} dimulai (frame ${frame.id})`);
    this.dispatch({ type: 'start', sessionNo: no, frameId: frame.id, slotCount: frame.slots.length, cfg });
    return null;
  }

  // ---------- unggahan dari /booth (HTTP) ----------

  private nextRev(): number {
    this.lastRev = Math.max(this.lastRev + 1, Date.now());
    return this.lastRev;
  }

  /** Simpan foto satu slot. Hanya diterima untuk jepretan yang sedang ditunggu server. */
  acceptShot(no: number, slot: number, data: Buffer): 'ok' | 'rejected' {
    const s = this.state;
    const waiting = (s.phase === 'flash' || s.phase === 'between') && s.pendingShot;
    if (!waiting || s.sessionNo !== no || s.current !== slot) return 'rejected';

    this.deps.store.writeShot(no, slot, data);
    const rev = this.nextRev();
    this.dispatch({ type: 'shotSaved', slot, rev });
    this.deps.store.updateMeta(no, (m) => ({ ...m, slotRevs: this.state.slotRevs }));
    return 'ok';
  }

  acceptStrip(no: number, data: Buffer): 'ok' | 'rejected' {
    const s = this.state;
    if (s.phase !== 'assembling' || s.sessionNo !== no) return 'rejected';

    this.deps.store.writeStrip(no, data);
    const rev = this.nextRev();
    this.dispatch({ type: 'stripReady', rev });
    this.deps.store.updateMeta(no, (m) => ({ ...m, stripRev: rev, slotRevs: this.state.slotRevs }));
    return 'ok';
  }

  // ---------- WebSocket ----------

  attach(ws: WebSocket): void {
    this.clients.set(ws, null);
    this.send(ws, { type: 'state', state: this.publicState() });

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString()) as ClientMsg;
      } catch {
        return;
      }
      this.handleMessage(ws, msg);
    });
    ws.on('close', () => {
      const role = this.clients.get(ws);
      this.clients.delete(ws);
      if (role === 'booth' && this.boothCount() === 0) this.boothCamera = null;
      this.broadcastState();
    });
    ws.on('error', () => ws.terminate());
  }

  private handleMessage(ws: WebSocket, msg: ClientMsg): void {
    if (msg.type === 'hello') {
      if (msg.role === 'admin' || msg.role === 'booth') {
        this.clients.set(ws, msg.role);
        this.broadcastState();
      }
      return;
    }
    const role = this.clients.get(ws);
    if (!role) return;

    if (role === 'booth') {
      if (msg.type === 'camera.status') {
        this.boothCamera = { ok: msg.ok, error: msg.error };
        this.broadcastState();
      } else if (msg.type === 'shot.failed') {
        this.deps.log?.(`foto slot ${msg.slot} gagal di booth: ${msg.reason ?? '-'}`);
        this.dispatch({ type: 'shotFailed', slot: msg.slot });
      } else if (msg.type === 'strip.failed') {
        this.deps.log?.(`perakitan strip gagal di booth: ${msg.reason ?? '-'}`);
        this.dispatch({ type: 'stripFailed' });
      }
      return;
    }

    // role === 'admin'
    switch (msg.type) {
      case 'camera.select':
        this.cameraId = msg.deviceId;
        this.boothCamera = null;
        this.broadcastState();
        break;
      case 'start': {
        const err = this.startSession();
        if (err) {
          this.setNotice(err);
          this.broadcastState();
        }
        break;
      }
      case 'retake.toggle':
        this.dispatch({ type: 'toggleRetake', slot: msg.slot });
        break;
      case 'retake.start': {
        const before = this.state;
        this.dispatch({ type: 'startRetake' });
        if (before.phase === 'review' && this.state.phase === 'retake_intro' && before.sessionNo !== null) {
          this.deps.store.updateMeta(before.sessionNo, (m) => ({ ...m, retakes: m.retakes + 1 }));
        }
        break;
      }
      case 'finish':
        this.dispatch({ type: 'finish' });
        break;
      case 'cancel':
        this.dispatch({ type: 'cancel' });
        break;
      default:
        break;
    }
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
