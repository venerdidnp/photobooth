import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/StatusChip';
import { api } from '../lib/server';
import type { AdminCtx } from './parts';

interface Info {
  dataDir: string;
  framesDir: string;
  frames: number;
}

/** Pengaturan Google Drive dan lokasi penyimpanan lokal (pengaturan sesi ada di halaman Kontrol). */
export function SettingsPage({ ctx }: { ctx: AdminCtx }) {
  const { state, frames } = ctx;
  const [info, setInfo] = useState<Info | null>(null);
  const [driveMsg, setDriveMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drive = state.drive;

  useEffect(() => {
    api<Info>('/api/info').then(setInfo).catch(() => undefined);
  }, []);

  const changeFolder = async () => {
    const input = window.prompt('Tempel link atau ID folder Google Drive:');
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
      setDriveMsg(json.ok ? `Folder diganti ke "${json.name}".` : (json.error ?? 'Folder tidak bisa diganti.'));
    } catch {
      setDriveMsg('Tidak bisa menghubungi server.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Putuskan Google Drive? Upload berhenti sampai kamu menjalankan "npm run drive:setup" lagi.')) return;
    setBusy(true);
    await fetch('/api/drive/disconnect', { method: 'POST' }).catch(() => undefined);
    setDriveMsg('Terputus.');
    setBusy(false);
  };

  return (
    <div className="op-grid op-grid--drive">
      <Card title="Google Drive" sub="Strip yang selesai diunggah otomatis ke folder ini.">
        <div className="card__stack">
          <div className="row">
            {drive.status === 'ok' ? (
              <StatusChip tone="ok">Terhubung</StatusChip>
            ) : drive.status === 'error' ? (
              <StatusChip tone="bad">Error</StatusChip>
            ) : (
              <StatusChip tone="warn">Belum Diatur</StatusChip>
            )}
            <span>{drive.account ?? '-'}</span>
          </div>
          <div className="kv">
            <span className="kv__label">Folder Upload</span>
            <div className="kv__box">{drive.folderName ?? '-'}</div>
          </div>
          {drive.error && <p className="empty-note">{drive.error}</p>}
          {!drive.configured && !drive.error && <p className="empty-note">Lihat README untuk menghubungkan Google Drive.</p>}
          {driveMsg && <p className="empty-note">{driveMsg}</p>}
          <div className="btn-row">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void changeFolder()}>
              Ganti Folder
            </Button>
            <Button variant="danger" size="sm" disabled={busy || !drive.configured} onClick={() => void disconnect()}>
              Putuskan
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Penyimpanan Lokal">
        <div className="card__stack">
          <div className="kv">
            <span className="kv__label">Folder Simpan</span>
            <span className="kv__value mono">{info ? `${info.dataDir}/sessions` : '-'}</span>
          </div>
          <div className="kv">
            <span className="kv__label">Folder Frame</span>
            <span className="kv__value mono">{info?.framesDir ?? '-'}</span>
          </div>
          <div>
            <StatusChip tone={frames.length > 0 ? 'ok' : 'bad'}>{frames.length > 0 ? `${frames.length} frame ditemukan` : 'Frame tidak ditemukan'}</StatusChip>
          </div>
        </div>
      </Card>
    </div>
  );
}
