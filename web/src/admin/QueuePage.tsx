import { useEffect, useState } from 'react';
import { formatSessionNo, stripFileName, type QueueItem, type QueueSummary } from '../../../shared/protocol';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Progress } from '../components/Progress';
import { StatusChip } from '../components/StatusChip';
import { api } from '../lib/server';
import type { AdminCtx } from './parts';

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Antrean upload ke Google Drive. */
export function QueuePage({ ctx }: { ctx: AdminCtx }) {
  const { state, send } = ctx;
  const [items, setItems] = useState<QueueItem[]>([]);

  const s: QueueSummary = state.uploads;
  const pending = s.queued + s.uploading;
  const summaryKey = `${s.queued}/${s.uploading}/${s.done}/${s.failed}`;

  // muat ulang daftar setiap ringkasan antrean berubah (dikirim server lewat WebSocket) + cadangan berkala
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ items: QueueItem[] }>('/api/queue')
        .then((r) => alive && setItems(r.items))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [summaryKey]);

  const lastProblem = items.find((i) => i.status === 'failed')?.error ?? items.find((i) => i.error)?.error;

  return (
    <>
      <div className="q-tiles">
        <SummaryTile kind="queued" label="Antre" value={s.queued} />
        <SummaryTile kind="uploading" label="Mengunggah" value={s.uploading} />
        <SummaryTile kind="done" label="Selesai" value={s.done} />
        <SummaryTile kind="failed" label="Gagal" value={s.failed} />
      </div>

      <Card
        title="Upload Terbaru"
        sub="Strip yang sudah selesai masuk antrean ini lalu diunggah di latar belakang."
        aside={<StatusChip tone={pending > 0 ? 'warn' : 'ok'}>{`${pending} menunggu`}</StatusChip>}
      >
        {items.length === 0 ? (
          <p className="empty-note">
            {state.drive.configured
              ? 'Tidak ada yang menunggu. Strip yang selesai akan muncul di sini.'
              : 'Upload Google Drive belum diatur. Strip tersimpan di laptop ini.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="q-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Sesi</th>
                  <th>Ukuran</th>
                  <th>Status</th>
                  <th>Progres</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} title={it.error}>
                    <td className="nowrap">{stripFileName(it.sessionNo)}</td>
                    <td>#{formatSessionNo(it.sessionNo)}</td>
                    <td className="nowrap">{mb(it.sizeBytes)}</td>
                    <td>
                      <StatusChip status={it.status} />
                    </td>
                    <td className="q-progress">
                      <Progress size="sm" value={it.status === 'done' ? 1 : it.progress} />
                    </td>
                    <td>
                      {it.status === 'failed' ? (
                        <Button variant="secondary" size="sm" onClick={() => send({ type: 'queue.retry', id: it.id })}>
                          Coba Lagi
                        </Button>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!state.drive.configured && items.length > 0 && (
          <p className="empty-note" style={{ marginTop: 12 }}>
            Google Drive belum diatur, jadi strip menunggu di sini (dan tetap ada di laptop ini) sampai Drive terhubung.
          </p>
        )}
        {lastProblem && (
          <p className="empty-note" style={{ marginTop: 12 }}>
            Masalah terakhir: {lastProblem}
          </p>
        )}
      </Card>
    </>
  );
}

function SummaryTile({ kind, label, value }: { kind: string; label: string; value: number }) {
  return (
    <div className="q-tile">
      <span className="q-tile__label">
        <span className={`dot dot--${kind}`} />
        {label}
      </span>
      <span className="q-tile__value">{value}</span>
    </div>
  );
}
