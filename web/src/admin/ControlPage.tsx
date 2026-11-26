import { useEffect, useState } from 'react';
import { formatSessionNo, SETTINGS_LIMITS, type PublicState, type SessionSummary } from '../../../shared/protocol';
import { BoothScreen } from '../booth/BoothScreen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SelectField, SwitchRow, Toggle } from '../components/Controls';
import { Keycap } from '../components/Keycap';
import { LiveVideo } from '../components/LiveVideo';
import { FitBox } from '../components/Stage';
import { StatusChip } from '../components/StatusChip';
import { SlotBadge } from '../components/SlotBadge';
import { DEMO_CAMERA_ID } from '../lib/camera';
import { api, sessionFileUrl } from '../lib/server';
import { DriveChip, PHASE_LABEL, type AdminCtx } from './parts';

const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();

export function ControlPage({ ctx }: { ctx: AdminCtx }) {
  return (
    <div className="op-grid">
      <div className="op-col">
        <MonitorCard ctx={ctx} />
        <PosesCard ctx={ctx} />
        <HistoryCard ctx={ctx} />
      </div>
      <aside className="op-col">
        <CameraCard ctx={ctx} />
        <FrameCard ctx={ctx} />
        <DriveCard ctx={ctx} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- monitor + tombol sesi

function MonitorCard({ ctx }: { ctx: AdminCtx }) {
  const { state, camera, frames, send } = ctx;
  const idle = state.phase === 'idle';
  const inReview = state.phase === 'review';
  const frame = state.frame ?? frames[0] ?? null;
  const canStart = idle && state.booth && frame !== null;
  const cancellable = !idle && state.phase !== 'saving' && state.phase !== 'saved';
  const selection = state.retakeSelection;
  const hasSelection = selection.length > 0;
  const noCamera = camera.stream === null;

  return (
    <Card
      title="Preview Monitor"
      aside={
        <div className="row">
          <StatusChip tone={idle ? 'ok' : 'warn'}>{PHASE_LABEL[state.phase]}</StatusChip>
          <span className="hint">
            <span>Pintasan:</span> <Keycap label="Spasi" /> Mulai · <Keycap label="Enter" /> Lanjut · <Keycap label="Esc" /> ×2 Batal
          </span>
        </div>
      }
    >
      <div className="monitor">
        {idle ? (
          <>
            <LiveVideo stream={camera.stream} mirror={state.settings.mirrorPreview} />
            {noCamera && (
              <div className="monitor__empty">
                <p className="monitor__empty-title">{camera.error ? 'Kamera Tidak Tersedia' : 'Memulai Kamera...'}</p>
                <p className="monitor__empty-text">
                  Izinkan akses kamera di browser atau pilih perangkat lain di panel kanan. Tanpa webcam, pakai kamera simulasi untuk uji coba.
                </p>
                <div className="monitor__actions">
                  <Button variant="primary" size="sm" onClick={camera.refresh}>
                    Coba Akses Kamera
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => camera.select(DEMO_CAMERA_ID)}>
                    Gunakan Kamera Simulasi
                  </Button>
                </div>
              </div>
            )}
            {!noCamera && <div className="monitor__pill">Siap berpose · Lihat ke arah kamera</div>}
          </>
        ) : (
          <FitBox width={1920} height={1080}>
            <BoothScreen state={state} mirror frames={ctx.frames} liveView={<p className="booth-stage__empty">LIVE</p>} />
          </FitBox>
        )}
      </div>

      <div className="toolbar">
        <div className="toolbar__actions">
          {idle && (
            <Button variant="primary" size="lg" disabled={!canStart} onMouseDown={noFocus} onClick={() => send({ type: 'start' })}>
              Mulai {frame?.slots.length ?? ''} Pose
            </Button>
          )}
          {inReview && hasSelection && (
            <Button variant="primary" size="lg" onMouseDown={noFocus} onClick={() => send({ type: 'retake.start' })}>
              Ulangi Pose {selection.join(' & ')}
            </Button>
          )}
          {inReview && (
            <Button variant="success" size="lg" disabled={hasSelection} onMouseDown={noFocus} onClick={() => send({ type: 'finish' })}>
              Simpan &amp; Upload
            </Button>
          )}
          {!idle && (
            <Button variant="secondary" size="lg" disabled={!cancellable} onMouseDown={noFocus} onClick={() => send({ type: 'cancel' })}>
              Batalkan Sesi
            </Button>
          )}
        </div>
        <p className="toolbar__status">{statusText(state, frame?.slots.length, canStart)}</p>
      </div>
    </Card>
  );
}

function statusText(state: PublicState, shots: number | undefined, canStart: boolean): string {
  if (state.phase === 'idle') {
    if (!state.booth) return 'Buka layar tamu (/booth) di monitor eksternal terlebih dahulu';
    if (!canStart) return 'Belum ada frame. Taruh PNG + JSON di folder frames';
    return `Siap mengambil sesi baru · #${formatSessionNo(state.nextNo)}`;
  }
  const shot = state.current ? ` · Pose ${state.current}/${shots ?? state.slotCount}` : '';
  return `Sesi #${formatSessionNo(state.sessionNo ?? 0)}${shot}`;
}

// ---------------------------------------------------------------- slot pose

function PosesCard({ ctx }: { ctx: AdminCtx }) {
  const { state, send } = ctx;
  const count = state.frame?.slots.length ?? state.slotCount;
  const inReview = state.phase === 'review';
  const no = state.sessionNo;
  const filled = no === null ? 0 : state.slotRevs.filter((r) => r > 0).length;

  return (
    <Card
      title={`Slot ${count} Pose & Retake Individual`}
      sub={inReview ? 'Pilih pose yang ingin diulang, lalu klik "Ulangi Pose".' : 'Ulangi pose tertentu tanpa perlu mengulang seluruh sesi.'}
      aside={<StatusChip>{`${filled} / ${count} terisi`}</StatusChip>}
    >
      <div className="poses">
        {Array.from({ length: count }, (_, i) => {
          const slot = i + 1;
          const rev = state.slotRevs[i] ?? 0;
          const hasPhoto = no !== null && rev > 0;
          const picked = state.retakeSelection.includes(slot);
          return (
            <div key={slot} className={picked ? 'pose pose--picked' : 'pose'}>
              <div className={hasPhoto ? 'pose__thumb pose__thumb--filled' : 'pose__thumb'}>
                {hasPhoto ? <img src={sessionFileUrl(no, `slot-${slot}.jpg`, rev)} alt="" draggable={false} /> : 'Kosong'}
                <SlotBadge number={slot} className="pose__badge" />
              </div>
              <div className="pose__row">
                <span>Pose {slot}</span>
                {inReview ? (
                  <Button
                    variant={picked ? 'primary' : 'secondary'}
                    size="sm"
                    onMouseDown={noFocus}
                    onClick={() => send({ type: 'retake.toggle', slot })}
                    aria-pressed={picked}
                  >
                    {picked ? 'Batal' : 'Ulangi'}
                  </Button>
                ) : (
                  <StatusChip tone={hasPhoto ? 'ok' : 'neutral'}>{hasPhoto ? 'Terisi' : 'Menunggu'}</StatusChip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- riwayat

function HistoryCard({ ctx }: { ctx: AdminCtx }) {
  const phase = ctx.state.phase;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // muat ulang saat fase berganti (mis. baru saja selesai) dan berkala
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SessionSummary[]>('/api/sessions')
        .then((r) => alive && setSessions(r.filter((s) => s.status === 'finalized').slice(0, 40)))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [phase]);

  return (
    <Card
      title="Riwayat Sesi"
      sub="Klik strip untuk membuka ukuran penuh di tab baru (bisa diunduh dari sana)."
      aside={<span className="muted">{sessions.length} strip</span>}
    >
      <div className="history">
        {sessions.length === 0 ? (
          <div className="history__empty">Belum ada strip yang disimpan.</div>
        ) : (
          sessions.map((s) => (
            <a key={s.no} className="history__item" href={sessionFileUrl(s.no, 'strip.png', s.stripRev)} target="_blank" rel="noreferrer">
              <img className="history__thumb" src={sessionFileUrl(s.no, 'strip.png', s.stripRev)} alt={`Strip #${s.label}`} loading="lazy" decoding="async" />
              <span className="history__label">
                <span className={`dot dot--${s.uploadStatus}`} />
                <span>#{s.label}</span>
              </span>
            </a>
          ))
        )}
      </div>
      <div className="legend">
        <LegendItem kind="done" label="Terunggah" />
        <LegendItem kind="uploading" label="Mengunggah" />
        <LegendItem kind="queued" label="Antre" />
        <LegendItem kind="failed" label="Gagal" />
      </div>
    </Card>
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

// ---------------------------------------------------------------- kolom kanan

/** Daftar nilai + nilai saat ini (kalau belum ada di daftar), urut naik. */
function numberOptions(values: number[], current: number, unit: string): [string, string][] {
  return [...new Set([...values, current])].sort((a, b) => a - b).map((v) => [String(v), `${v} ${unit}`]);
}

function CameraCard({ ctx }: { ctx: AdminCtx }) {
  const { camera, state, saveSettings } = ctx;
  const idle = state.phase === 'idle';
  const s = state.settings;
  const L = SETTINGS_LIMITS;
  const cameraOptions: [string, string][] = [
    ...camera.devices.map((d, i): [string, string] => [d.deviceId, d.label || `Kamera ${i + 1}`]),
    [DEMO_CAMERA_ID, 'Kamera simulasi (tanpa webcam)'],
  ];

  return (
    <Card
      title="Kamera & Sesi"
      aside={
        <Button variant="secondary" size="sm" onClick={camera.refresh}>
          Refresh
        </Button>
      }
    >
      <div className="card__stack">
        <SelectField
          label="Perangkat Kamera"
          value={camera.selectedId ?? ''}
          options={cameraOptions}
          disabled={!idle}
          onChange={camera.select}
        />
        {state.boothCamera && !state.boothCamera.ok && (
          <p className="empty-note">Layar tamu tidak bisa membuka kamera. Periksa webcam atau pakai kamera simulasi.</p>
        )}
        <div className="row" style={{ alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <SelectField
              label="Hitung Mundur"
              value={String(s.countdownSec)}
              options={numberOptions([3, 5, 7, 10], s.countdownSec, 'detik').filter(([v]) => Number(v) >= L.countdownSec.min && Number(v) <= L.countdownSec.max)}
              disabled={!idle}
              onChange={(v) => saveSettings({ countdownSec: Number(v) })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <SelectField
              label="Jeda Antar Pose"
              value={String(s.pauseSec)}
              options={numberOptions([2, 3, 5, 8, 10], s.pauseSec, 'detik').filter(([v]) => Number(v) >= L.pauseSec.min && Number(v) <= L.pauseSec.max)}
              disabled={!idle}
              onChange={(v) => saveSettings({ pauseSec: Number(v) })}
            />
          </div>
        </div>
        <div className="card__stack" style={{ gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <SwitchRow label="Mirror / Flip Kamera">
            <Toggle label="Mirror kamera" on={s.mirrorPreview} onChange={(v) => saveSettings({ mirrorPreview: v })} />
          </SwitchRow>
          <SwitchRow label="Suara Hitung Mundur & Shutter">
            <Toggle label="Suara" on={s.sound} onChange={(v) => saveSettings({ sound: v })} />
          </SwitchRow>
          <SwitchRow label="Efek Flash Putih">
            <Toggle label="Flash" on={s.flash} onChange={(v) => saveSettings({ flash: v })} />
          </SwitchRow>
        </div>
      </div>
    </Card>
  );
}

function FrameCard({ ctx }: { ctx: AdminCtx }) {
  const { frames, state, saveSettings } = ctx;
  const idle = state.phase === 'idle';
  const selectedId = state.frame?.id ?? null;
  return (
    <Card title="Frame" sub="Tamu melihat daftar ini di layar awal. Klik untuk memilih, atau tekan F untuk berganti.">
      {frames.length === 0 ? (
        <p className="empty-note">Belum ada frame.</p>
      ) : (
        <div className="frames">
          {frames.map((f) => {
            const selected = f.id === selectedId;
            return (
              <button
                key={f.id}
                type="button"
                className={selected ? 'frame-option frame-option--selected' : 'frame-option'}
                disabled={!idle}
                onClick={() => saveSettings({ frameId: f.id })}
                aria-pressed={selected}
              >
                <span className="frame-thumb">
                  <img src={f.imageUrl} alt="" draggable={false} />
                </span>
                <span className="frame-option__name">
                  <span>{f.name}</span>
                  {selected && <StatusChip tone="ok">Dipakai</StatusChip>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function DriveCard({ ctx }: { ctx: AdminCtx }) {
  const { state, goTab } = ctx;
  const drive = state.drive;
  return (
    <Card title="Integrasi Google Drive" aside={<DriveChip drive={drive} />}>
      <div className="card__stack" style={{ gap: 10 }}>
        <p className="empty-note">
          {drive.status === 'ok'
            ? `Strip otomatis diunggah ke folder "${drive.folderName ?? '-'}".`
            : 'Hubungkan Google Drive agar strip otomatis terunggah ke folder acara. Selama belum, strip tetap tersimpan di laptop ini.'}
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => goTab('settings')}>
            Buka Pengaturan Drive
          </Button>
        </div>
      </div>
    </Card>
  );
}
