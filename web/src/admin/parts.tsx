import type { ReactNode } from 'react';
import { formatSessionNo, type ClientMsg, type FrameInfo, type PublicState, type Settings } from '../../../shared/protocol';
import { StatusChip } from '../components/StatusChip';

export type Tab = 'control' | 'queue' | 'settings';

/** Semua yang dibutuhkan halaman operator dari shell. */
export interface AdminCtx {
  state: PublicState;
  send: (msg: ClientMsg) => void;
  frames: FrameInfo[];
  saveSettings: (patch: Partial<Settings>) => void;
  goTab: (tab: Tab) => void;
  camera: {
    devices: MediaDeviceInfo[];
    selectedId: string | null;
    select: (id: string) => void;
    refresh: () => void;
    stream: MediaStream | null;
    error: string | null;
  };
}

const NAV: { tab: Tab; label: string }[] = [
  { tab: 'control', label: 'Kontrol' },
  { tab: 'queue', label: 'Antrean Upload' },
  { tab: 'settings', label: 'Pengaturan' },
];

function CameraIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export function openGuestWindow(): void {
  window.open('/booth', 'photobooth-guest', 'popup,width=1280,height=720');
}

/** Header lengket: merek acara, tab, status koneksi, tombol buka layar tamu. */
export function Header({ tab, onTab, state, extra }: { tab: Tab; onTab: (t: Tab) => void; state: PublicState; extra?: ReactNode }) {
  const sessionNo = state.sessionNo ?? state.nextNo;
  return (
    <header className="op-header">
      <div className="op-header__inner">
        <div className="brand">
          <div className="brand__icon">
            <CameraIcon />
          </div>
          <div>
            <h1 className="brand__title">
              DIES NATALIS INFORMATIKA <span>·</span> KE-6
            </h1>
            <p className="brand__sub">Panel Operator Photobooth{state.frame ? ` · ${state.frame.slots.length} Pose` : ''}</p>
          </div>
        </div>

        <nav className="tabs" aria-label="Menu utama">
          {NAV.map((n) => (
            <button
              key={n.tab}
              type="button"
              className={tab === n.tab ? 'tab tab--active' : 'tab'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTab(n.tab)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="op-header__right">
          <StatusChip tone={state.booth ? 'ok' : 'warn'}>{state.booth ? 'Layar Tamu: Tersambung' : 'Layar Tamu: Belum Dibuka'}</StatusChip>
          <StatusChip tone={state.online ? 'ok' : 'bad'}>{state.online ? 'Online' : 'Offline'}</StatusChip>
          {extra}
          <DriveChip drive={state.drive} />
          <StatusChip>{`Sesi #${formatSessionNo(sessionNo)}`}</StatusChip>
          <button type="button" className="btn btn--primary btn--sm" onClick={openGuestWindow}>
            Buka Layar Tamu
          </button>
        </div>
      </div>
    </header>
  );
}

export function DriveChip({ drive }: { drive: PublicState['drive'] }) {
  if (drive.status === 'ok') return <StatusChip tone="ok">Drive OK</StatusChip>;
  if (drive.status === 'error') return <StatusChip tone="bad">Drive Error</StatusChip>;
  return <StatusChip tone="warn">Drive Belum Diatur</StatusChip>;
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="toast" role="alert">
      {text}
    </div>
  );
}

export const PHASE_LABEL: Record<PublicState['phase'], string> = {
  idle: 'Siap',
  ready: 'Bersiap',
  countdown: 'Hitung Mundur',
  flash: 'Jepret',
  between: 'Pose Berikutnya',
  assembling: 'Menyusun Strip',
  review: 'Review',
  retake_intro: 'Ulang Pose',
  saving: 'Menyimpan',
  saved: 'Tersimpan',
};
