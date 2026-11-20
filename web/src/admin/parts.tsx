import type { ReactNode } from 'react';
import { formatSessionNo, type ClientMsg, type FrameInfo, type PublicState, type Settings } from '../../../shared/protocol';
import { NavIcon, PixelLogo } from '../components/Pixel';
import { StatusChip } from '../components/StatusChip';

export type Tab = 'control' | 'queue' | 'gallery' | 'settings';

/** Semua yang dibutuhkan halaman operator dari shell. */
export interface AdminCtx {
  state: PublicState;
  send: (msg: ClientMsg) => void;
  frames: FrameInfo[];
  saveSettings: (patch: Partial<Settings>) => void;
  camera: {
    devices: MediaDeviceInfo[];
    selectedId: string | null;
    select: (id: string) => void;
    stream: MediaStream | null;
    error: string | null;
  };
}

const NAV: { tab: Tab; label: string }[] = [
  { tab: 'control', label: 'CONTROL' },
  { tab: 'queue', label: 'QUEUE' },
  { tab: 'gallery', label: 'GALLERY' },
  { tab: 'settings', label: 'SETTINGS' },
];

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <PixelLogo />
      <div className="sidebar__spacer" />
      {NAV.map((n) => (
        <button
          key={n.tab}
          type="button"
          className={tab === n.tab ? 'nav-item nav-item--active' : 'nav-item'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onTab(n.tab)}
        >
          <NavIcon name={n.tab} />
          <span>{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function TopBar({ title, state, extra }: { title: string; state: PublicState; extra?: ReactNode }) {
  const sessionNo = state.sessionNo ?? state.nextNo;
  return (
    <header className="topbar">
      <h1 className="t-title-m nowrap">{title}</h1>
      <div className="chips">
        <StatusChip tone={state.booth ? 'turquoise' : 'danger'}>{state.booth ? 'BOOTH OK' : 'NO BOOTH'}</StatusChip>
        <StatusChip tone={state.online ? 'turquoise' : 'danger'}>{state.online ? 'ONLINE' : 'OFFLINE'}</StatusChip>
        {extra}
        <DriveChip drive={state.drive} />
        <StatusChip tone="yellow">SESSION #{formatSessionNo(sessionNo)}</StatusChip>
      </div>
    </header>
  );
}

export function DriveChip({ drive }: { drive: PublicState['drive'] }) {
  if (drive.status === 'ok') return <StatusChip tone="turquoise">DRIVE OK</StatusChip>;
  if (drive.status === 'error') return <StatusChip tone="danger">DRIVE ERROR</StatusChip>;
  return <StatusChip tone="orange">DRIVE OFF</StatusChip>;
}

/** Tombol dengan petunjuk keyboard di bawahnya. */
export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="toast t-label-m" role="alert">
      {text}
    </div>
  );
}

/** Panah turun bergaya piksel untuk <select>. */
export function PixelArrow() {
  return (
    <svg className="select-arrow" width="20" height="12" viewBox="0 0 20 12" aria-hidden>
      <rect x="0" y="0" width="20" height="4" style={{ fill: 'var(--ink-main)' }} />
      <rect x="4" y="4" width="12" height="4" style={{ fill: 'var(--ink-main)' }} />
      <rect x="8" y="8" width="4" height="4" style={{ fill: 'var(--ink-main)' }} />
    </svg>
  );
}

export const PHASE_LABEL: Record<PublicState['phase'], string> = {
  idle: 'IDLE',
  ready: 'GET READY',
  countdown: 'COUNTDOWN',
  flash: 'SNAP',
  between: 'NEXT SHOT',
  assembling: 'BUILDING',
  review: 'REVIEW',
  retake_intro: 'RETAKE',
  saving: 'SAVING',
  saved: 'SAVED',
};

export const GUEST_SCREEN: Record<PublicState['phase'], string> = {
  idle: 'ATTRACT',
  ready: 'READY',
  countdown: 'COUNTDOWN',
  flash: 'FLASH',
  between: 'BETWEEN SHOTS',
  assembling: 'BETWEEN SHOTS',
  review: 'REVIEW',
  retake_intro: 'RETAKE',
  saving: 'SAVING',
  saved: 'SAVED',
};
