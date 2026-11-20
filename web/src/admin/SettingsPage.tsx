import { useEffect, useState, type ReactNode } from 'react';
import { SETTINGS_LIMITS } from '../../../shared/protocol';
import { Button } from '../components/Button';
import { Stepper, Toggle } from '../components/Controls';
import { Panel } from '../components/Panel';
import { StatusChip } from '../components/StatusChip';
import { api } from '../lib/server';
import { TopBar, type AdminCtx } from './parts';

interface Info {
  dataDir: string;
  framesDir: string;
  frames: number;
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <>
      <div className="setting-row">
        <div className="setting-row__text">
          <span className="t-label-m nowrap">{label}</span>
          {note && <span className="t-body-m is-soft">{note}</span>}
        </div>
        {children}
      </div>
      <div className="divider" />
    </>
  );
}

/** O5: pengaturan sesi, status Google Drive, dan lokasi penyimpanan lokal. */
export function SettingsPage({ ctx }: { ctx: AdminCtx }) {
  const { state, frames, saveSettings } = ctx;
  const s = state.settings;
  const L = SETTINGS_LIMITS;
  const idle = state.phase === 'idle';
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    api<Info>('/api/info').then(setInfo).catch(() => undefined);
  }, []);

  const drive = state.drive;
  const shots = state.frame?.slots.length ?? frames[0]?.slots.length ?? 3;
  const [driveMsg, setDriveMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const changeFolder = async () => {
    const input = window.prompt('Paste the Google Drive folder link or ID:');
    if (!input) return;
    setBusy(true);
    setDriveMsg(null);
    try {
      const res = await fetch('/api/drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: input }),
      });
      const json = (await res.json()) as { ok: boolean; name?: string; error?: string };
      setDriveMsg(json.ok ? `Folder changed to "${json.name}".` : (json.error ?? 'Could not change the folder.'));
    } catch {
      setDriveMsg('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Uploads pause until you run "npm run drive:setup" again.')) return;
    setBusy(true);
    await fetch('/api/drive/disconnect', { method: 'POST' }).catch(() => undefined);
    setDriveMsg('Disconnected.');
    setBusy(false);
  };

  return (
    <>
      <TopBar title="SETTINGS" state={state} />
      <div className="admin-body">
        <Panel title="SESSION SETTINGS" className="settings-panel">
          <Row label="COUNTDOWN (SEC)">
            <Stepper value={s.countdownSec} min={L.countdownSec.min} max={L.countdownSec.max} readOnly={!idle} onChange={(v) => saveSettings({ countdownSec: v })} />
          </Row>
          <Row label="NUMBER OF SHOTS" note="Set by the selected frame.">
            <Stepper value={shots} min={shots} max={shots} readOnly />
          </Row>
          <Row label="PAUSE BETWEEN (SEC)">
            <Stepper value={s.pauseSec} min={L.pauseSec.min} max={L.pauseSec.max} readOnly={!idle} onChange={(v) => saveSettings({ pauseSec: v })} />
          </Row>
          <Row label="MIRROR LIVE PREVIEW">
            <Toggle label="Mirror live preview" on={s.mirrorPreview} onChange={(v) => saveSettings({ mirrorPreview: v })} />
          </Row>
          <Row label="SOUND EFFECTS">
            <Toggle label="Sound effects" on={s.sound} onChange={(v) => saveSettings({ sound: v })} />
          </Row>
          <Row label="SHUTTER FLASH">
            <Toggle label="Shutter flash" on={s.flash} onChange={(v) => saveSettings({ flash: v })} />
          </Row>
        </Panel>

        <div className="col col--520">
          <Panel title="GOOGLE DRIVE">
            <div className="row">
              {drive.status === 'ok' ? (
                <StatusChip tone="turquoise">CONNECTED</StatusChip>
              ) : drive.status === 'error' ? (
                <StatusChip tone="danger">ERROR</StatusChip>
              ) : (
                <StatusChip tone="orange">NOT SET UP</StatusChip>
              )}
              <span className="t-body-l nowrap">{drive.account ?? '-'}</span>
            </div>
            <p className="t-label-s is-soft nowrap">UPLOAD FOLDER</p>
            <div className="folder-input">{drive.folderName ?? '-'}</div>
            {drive.error && <p className="empty-note">{drive.error}</p>}
            {!drive.configured && !drive.error && <p className="empty-note">See the README to connect Google Drive.</p>}
            {driveMsg && <p className="empty-note">{driveMsg}</p>}
            <div className="btn-row">
              <Button variant="secondary" size="compact" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void changeFolder()}>
                CHANGE FOLDER
              </Button>
              <Button variant="danger" size="compact" disabled={busy || !drive.configured} onMouseDown={(e) => e.preventDefault()} onClick={() => void disconnect()}>
                DISCONNECT
              </Button>
            </div>
          </Panel>

          <Panel title="LOCAL STORAGE">
            <p className="t-label-s is-soft nowrap">SAVE FOLDER</p>
            <p className="path-text">{info ? `${info.dataDir}/sessions` : '-'}</p>
            <p className="t-label-s is-soft nowrap">FRAMES FOLDER</p>
            <div className="stack">
              <p className="path-text">{info?.framesDir ?? '-'}</p>
              <StatusChip tone={frames.length > 0 ? 'turquoise' : 'danger'}>
                {frames.length > 0 ? `${frames.length} FOUND` : 'NONE FOUND'}
              </StatusChip>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
