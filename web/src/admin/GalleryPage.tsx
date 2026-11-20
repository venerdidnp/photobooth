import { useEffect, useState } from 'react';
import type { SessionSummary } from '../../../shared/protocol';
import { Panel } from '../components/Panel';
import { api, sessionFileUrl } from '../lib/server';
import { TopBar, type AdminCtx } from './parts';

/** O4: strip yang sudah selesai, terbaru dulu. Klik untuk membuka strip penuh di tab baru. */
export function GalleryPage({ ctx }: { ctx: AdminCtx }) {
  const { state } = ctx;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // muat ulang saat sesi berganti fase (mis. baru saja selesai) dan berkala
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SessionSummary[]>('/api/sessions')
        .then((r) => alive && setSessions(r.filter((s) => s.status === 'finalized')))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [state.phase]);

  return (
    <>
      <TopBar title="GALLERY" state={state} />
      <div className="admin-body">
        <Panel title="RECENT STRIPS" className="gallery-panel">
          <div className="gallery-scroll">
            {sessions.length === 0 ? (
              <p className="empty-note">No finished strips yet.</p>
            ) : (
              <div className="gallery-grid">
                {sessions.map((s) => (
                  <a
                    key={s.no}
                    className="card"
                    href={sessionFileUrl(s.no, 'strip.png', s.stripRev)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="mini-strip">
                      {Array.from({ length: s.slotCount }, (_, i) => (
                        <img
                          key={i}
                          className="mini-strip__photo"
                          src={sessionFileUrl(s.no, `slot-${i + 1}.jpg`, s.slotRevs[i] ?? 0)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ))}
                    </div>
                    <div className="card__label t-label-s">
                      <span className={`dot dot--${s.uploadStatus}`} />
                      <span>#{s.label}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="legend t-label-s is-soft">
            <LegendItem kind="done" label="UPLOADED" />
            <LegendItem kind="uploading" label="UPLOADING" />
            <LegendItem kind="queued" label="QUEUED" />
            <LegendItem kind="failed" label="FAILED" />
          </div>
        </Panel>
      </div>
    </>
  );
}

function LegendItem({ kind, label }: { kind: string; label: string }) {
  return (
    <span className="legend__item">
      <span className={`dot dot--${kind}`} />
      <span>{label}</span>
    </span>
  );
}
