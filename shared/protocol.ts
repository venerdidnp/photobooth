// Kontrak bersama server <-> /admin <-> /booth. Hanya tipe + konstanta murni (tanpa dependensi Node/DOM).

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Isi frames/<id>.json + url PNG-nya. */
export interface FrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  slots: SlotRect[];
  imageUrl: string;
}

export interface Settings {
  /** Frame terakhir yang dipilih operator (id = nama file tanpa ekstensi). */
  frameId: string | null;
  countdownSec: number;
  pauseSec: number;
  /** Balik horizontal live preview di /booth (seperti cermin). Foto hasil tidak dibalik. */
  mirrorPreview: boolean;
  sound: boolean;
  /** Efek flash putih saat jepret. */
  flash: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  // Frame awal di instalasi baru (data/ kosong). Kalau id ini tidak ada, server memakai frame pertama (urut abjad).
  frameId: 'dies-natalis',
  countdownSec: 5,
  pauseSec: 5,
  mirrorPreview: true,
  sound: true,
  flash: true,
};

export const SETTINGS_LIMITS = {
  countdownSec: { min: 3, max: 15 },
  pauseSec: { min: 1, max: 20 },
} as const;

export type Phase =
  | 'idle' // G1 Attract
  | 'ready' // G2 Ready
  | 'countdown' // G3 Countdown
  | 'flash' // G4 Flash
  | 'between' // G5 Between shots
  | 'assembling' // strip dirakit di /booth (sebentar)
  | 'review' // G6 Review
  | 'retake_intro' // G7 Retake
  | 'saving' // G8a Saving
  | 'saved'; // G8b Saved / G9 Offline

/** Snapshot pengaturan yang dipakai satu sesi (tidak berubah di tengah sesi). */
export interface SessionCfg {
  readySec: number;
  countdownSec: number;
  pauseSec: number;
  /** Lama tampilan flash (ms). */
  flashMs: number;
  retakeIntroSec: number;
  savedSec: number;
  flashEffect: boolean;
}

export const SAVING_STEPS = 3;

export interface SessionState {
  phase: Phase;
  /** Naik setiap ganti fase; event timer dengan gen lama dibuang. */
  gen: number;
  sessionNo: number | null;
  frameId: string | null;
  slotCount: number;
  cfg: SessionCfg | null;
  /** Revisi foto per slot (0 = belum ada). Dipakai untuk cache-busting URL. */
  slotRevs: number[];
  /** Slot yang masih akan difoto (tidak termasuk slot yang sedang berjalan). */
  queue: number[];
  /** Slot (1-based) yang sedang difoto. */
  current: number | null;
  /** Hitung mundur/jeda tersisa (detik). */
  count: number;
  /** Nilai awal `count` pada fase ini (untuk progress bar). */
  total: number;
  isRetake: boolean;
  /** Slot yang sedang diulang pada putaran retake ini. */
  retaking: number[];
  /** Pilihan operator di fase review. */
  retakeSelection: number[];
  /** Foto slot `current` sudah dijepret tapi belum selesai tersimpan di server. */
  pendingShot: boolean;
  shotId: number;
  stripRev: number;
  attempts: number;
  savingStep: number;
  /** Diisi saat masuk 'saved': true = tidak ada internet (layar G9). */
  savedOffline: boolean;
}

export interface Notice {
  id: number;
  code: 'SHOT_RETRY' | 'STRIP_RETRY' | 'CAMERA_ERROR' | 'NO_BOOTH' | 'NO_FRAME' | 'BAD_STATE';
  text: string;
}

export interface QueueItem {
  id: string;
  sessionNo: number;
  file: string;
  sizeBytes: number;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  attempts: number;
  progress: number; // 0..1
  nextAttemptAt?: number;
  error?: string;
}

export interface QueueSummary {
  queued: number;
  uploading: number;
  done: number;
  failed: number;
}

export interface DriveInfo {
  /** true bila kredensial + folder Drive sudah dikonfigurasi (Fase 2). */
  configured: boolean;
  /** Teks status singkat untuk panel operator. */
  status: 'off' | 'ok' | 'error';
  account?: string;
  folderName?: string;
  error?: string;
}

/** Semua yang dikirim server ke /admin dan /booth. */
export interface PublicState extends SessionState {
  /** Nomor sesi berikutnya (untuk tampilan "NEXT PHOTO #043"). */
  nextNo: number;
  online: boolean;
  /** Ada /booth yang tersambung. */
  booth: boolean;
  /** Status kamera di /booth (null = belum ada laporan). */
  boothCamera: { ok: boolean; error?: string } | null;
  cameraId: string | null;
  settings: Settings;
  frame: FrameInfo | null;
  drive: DriveInfo;
  /** Ringkasan antrean upload (bukan antrean slot foto: itu `queue` di SessionState). */
  uploads: QueueSummary;
  notice: Notice | null;
}

export type ClientRole = 'admin' | 'booth';

export type ClientMsg =
  | { type: 'hello'; role: ClientRole }
  // admin
  | { type: 'camera.select'; deviceId: string | null }
  | { type: 'start' }
  | { type: 'retake.toggle'; slot: number }
  | { type: 'retake.start' }
  | { type: 'finish' }
  | { type: 'cancel' }
  | { type: 'queue.retry'; id?: string }
  // booth
  | { type: 'camera.status'; ok: boolean; error?: string }
  | { type: 'shot.failed'; slot: number; reason?: string }
  | { type: 'strip.failed'; reason?: string };

export type ServerMsg =
  | { type: 'state'; state: PublicState }
  /** Booth: ambil foto sekarang, upload ke POST /api/sessions/:no/shots/:slot. */
  | { type: 'capture'; sessionNo: number; slot: number }
  /** Booth: rakit strip dari foto di server, upload ke POST /api/sessions/:no/strip. */
  | { type: 'assemble'; sessionNo: number; frameId: string; slotRevs: number[] }
  | { type: 'error'; message: string };

/** Ringkasan sesi untuk Gallery operator. */
export interface SessionSummary {
  no: number;
  label: string; // "042"
  status: 'in_progress' | 'finalized' | 'cancelled' | 'abandoned';
  createdAt: string;
  finishedAt?: string;
  frameId: string;
  slotCount: number;
  slotRevs: number[];
  stripRev: number;
  uploadStatus: 'queued' | 'uploading' | 'done' | 'failed';
}

export function formatSessionNo(no: number): string {
  return String(no).padStart(3, '0');
}

/** Nama file yang dilihat tamu di Drive, mis. "PHOTO #042.png". */
export function stripFileName(no: number): string {
  return `PHOTO #${formatSessionNo(no)}.png`;
}
