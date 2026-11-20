import { useEffect, useState } from 'react';
import { formatSessionNo, stripFileName, type QueueItem, type QueueSummary } from '../../../shared/protocol';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { SegmentedBar } from '../components/SegmentedBar';
import { StatusChip } from '../components/StatusChip';
import { api } from '../lib/server';
import { TopBar, type AdminCtx } from './parts';

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** O3: antrean upload ke Google Drive (diisi pada Fase 2; di Fase 1 selalu kosong). */
export function QueuePage({ ctx }: { ctx: AdminCtx }) {
  const { state, send } = ctx;
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ items: QueueItem[] }>('/api/queue')
        .then((r) => alive && setItems(r.items))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const s: QueueSummary = state.uploads;
  const pending = s.queued + s.uploading;

  return (
    <>
      <TopBar
        title="UPLOAD QUEUE"
        state={state}
        extra={<StatusChip tone={pending > 0 ? 'orange' : 'turquoise'}>{`${pending} PENDING`}</StatusChip>}
      />
      <div className="admin-body">
        <div className="col" style={{ width: 1256 }}>
          <div className="q-tiles">
            <SummaryTile kind="queued" label="QUEUED" value={s.queued} />
            <SummaryTile kind="uploading" label="UPLOADING" value={s.uploading} />
            <SummaryTile kind="done" label="DONE" value={s.done} />
            <SummaryTile kind="failed" label="FAILED" value={s.failed} />
          </div>

          <Panel title="RECENT UPLOADS" className="full">
            <div className="q-head t-label-s is-soft">
              <span className="cell c-file">FILE</span>
              <span className="cell c-session">SESSION</span>
              <span className="cell c-size">SIZE</span>
              <span className="cell c-status">STATUS</span>
              <span className="cell c-progress">PROGRESS</span>
              <span className="cell c-action">ACTION</span>
            </div>
            {items.length === 0 ? (
              <p className="empty-note">
                {state.drive.configured
                  ? 'Nothing waiting. Finished strips will appear here.'
                  : 'Google Drive upload is not set up yet. Strips are saved on this laptop.'}
              </p>
            ) : (
              <div className="q-list">
                {items.map((it, i) => (
                  <div key={it.id} className={i % 2 === 0 ? 'q-row q-row--alt' : 'q-row'}>
                    <span className="cell c-file t-body-l nowrap">{stripFileName(it.sessionNo)}</span>
                    <span className="cell c-session t-label-s">#{formatSessionNo(it.sessionNo)}</span>
                    <span className="cell c-size t-body-l nowrap">{mb(it.sizeBytes)}</span>
                    <span className="cell c-status">
                      <StatusChip status={it.status} />
                    </span>
                    <span className="cell c-progress">
                      <SegmentedBar size="sm" filled={it.status === 'done' ? 10 : it.progress * 10} />
                    </span>
                    <span className="cell c-action">
                      {it.status === 'failed' ? (
                        <Button
                          variant="secondary"
                          size="xs"
                          style={{ boxShadow: 'var(--shadow-hard-4)' }}
                          onClick={() => send({ type: 'queue.retry', id: it.id })}
                        >
                          RETRY
                        </Button>
                      ) : (
                        <span className="t-label-s is-soft">-</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function SummaryTile({ kind, label, value }: { kind: string; label: string; value: number }) {
  return (
    <div className={`q-tile q-tile--${kind}`}>
      <span className="t-label-m">{label}</span>
      <span className="q-tile__value">{value}</span>
    </div>
  );
}
