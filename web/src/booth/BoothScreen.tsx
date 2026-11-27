import type { ReactNode } from 'react';
import { formatSessionNo, type FrameInfo, type PublicState } from '../../../shared/protocol';
import { Progress } from '../components/Progress';
import { SlotBadge } from '../components/SlotBadge';
import { sessionFileUrl } from '../lib/server';

interface Props {
  state: PublicState;
  /** Elemen tampilan langsung webcam (di /booth) atau placeholder (di cermin operator). */
  liveView?: ReactNode;
  /** Foto yang baru dijepret (blob lokal), supaya langsung tampil tanpa menunggu server. */
  localShotUrl?: string | null;
  /** Mode cermin di panel operator: kursor normal. */
  mirror?: boolean;
  /** Semua frame yang tersedia (untuk daftar pilihan di layar awal). */
  frames?: FrameInfo[];
}

/**
 * Seluruh tampilan tamu 1920x1080 sebagai fungsi dari state server.
 * Murni tampilan: tidak ada tombol/tautan.
 */
export function BoothScreen({ state, liveView, localShotUrl, mirror, frames = [] }: Props) {
  const phase = state.phase;
  const onStage = phase === 'idle' || phase === 'ready' || phase === 'countdown' || phase === 'flash' || phase === 'between' || phase === 'assembling';

  return (
    <div className={mirror ? 'booth booth--mirror' : 'booth'} onContextMenu={(e) => e.preventDefault()}>
      <Header state={state} />
      <div className="booth-main">
        {onStage ? <CameraStage state={state} liveView={liveView} localShotUrl={localShotUrl} frames={frames} /> : <ResultScreen state={state} />}
      </div>
      <Footer state={state} />
    </div>
  );
}

function Header({ state }: { state: PublicState }) {
  const active = state.sessionNo !== null && state.phase !== 'idle';
  const cur = state.current ?? state.queue[0] ?? 1;
  const inResult = state.phase === 'review' || state.phase === 'retake_intro' || state.phase === 'saving' || state.phase === 'saved';
  return (
    <div className="booth-header">
      <div className="booth-title">
        DIES NATALIS INFORMATIKA <span>·</span> KE-6
      </div>
      {active && (
        <div className="dots" aria-hidden>
          {Array.from({ length: state.slotCount }, (_, i) => {
            const slot = i + 1;
            const done = inResult || (state.isRetake ? !state.queue.includes(slot) && slot !== cur : slot < cur);
            const on = !inResult && slot === cur;
            return <span key={slot} className={on ? 'dots__dot dots__dot--on' : done ? 'dots__dot dots__dot--done' : 'dots__dot'} />;
          })}
        </div>
      )}
    </div>
  );
}

function Footer({ state }: { state: PublicState }) {
  return (
    <div className="booth-footer">
      <span>Photobooth Studio</span>
      <span>{footerStatus(state)}</span>
    </div>
  );
}

function footerStatus(state: PublicState): string {
  const no = state.sessionNo === null ? '' : `Sesi #${formatSessionNo(state.sessionNo)} · `;
  switch (state.phase) {
    case 'idle':
      return 'Menunggu operator';
    case 'ready':
      return `${no}Bersiap`;
    case 'countdown':
    case 'flash':
    case 'between':
    case 'assembling':
      return `${no}Mengambil foto`;
    case 'review':
      return `${no}Memeriksa hasil`;
    case 'retake_intro':
      return `${no}Mengulang pose`;
    case 'saving':
      return `${no}Menyimpan`;
    case 'saved':
      return `${no}Tersimpan`;
  }
}

// ---------------------------------------------------------------- idle + pengambilan foto

function CameraStage({
  state,
  liveView,
  localShotUrl,
  frames,
}: {
  state: PublicState;
  liveView?: ReactNode;
  localShotUrl?: string | null;
  frames: FrameInfo[];
}) {
  const phase = state.phase;
  const cur = state.current ?? state.queue[0] ?? 1;
  const total = state.slotCount;
  const no = state.sessionNo;

  const slotPhoto = no !== null && (state.slotRevs[cur - 1] ?? 0) > 0 ? sessionFileUrl(no, `slot-${cur}.jpg`, state.slotRevs[cur - 1] ?? 0) : null;
  const shotUrl = localShotUrl ?? slotPhoto;
  const showShot = (phase === 'between' || phase === 'assembling') && shotUrl !== null;
  const hasNext = state.queue.length > 0;

  return (
    <div className="booth-stage">
      {showShot ? (
        // preview ikut dicerminkan seperti live view supaya tidak "loncat"; file foto aslinya tetap tidak dibalik
        <img
          className="booth-shot"
          src={shotUrl}
          alt=""
          draggable={false}
          style={state.settings.mirrorPreview ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        liveView
      )}

      {phase === 'idle' && (
        <div className="booth-overlay booth-overlay--idle">
          <div className="attract">
            <p className="attract__tag">Photobooth · {state.frame ? `${state.frame.slots.length} Pose` : 'Strip Foto'}</p>
            <p className="attract__line">DIES NATALIS</p>
            <p className="attract__line attract__line--soft">INFORMATIKA KE-6</p>
          </div>

          {frames.length > 0 && (
            <div className="frame-picker">
              <p className="frame-picker__title">Pilih frame favoritmu · sebutkan ke operator</p>
              <div className="frame-picker__list">
                {frames.map((f) => {
                  const on = f.id === state.frame?.id;
                  return (
                    <div key={f.id} className={on ? 'frame-card frame-card--on' : 'frame-card'}>
                      <div className="frame-card__thumb">
                        <img src={f.imageUrl} alt="" draggable={false} />
                      </div>
                      <p className="frame-card__name">{f.name}</p>
                      <p className="frame-card__tag">{on ? 'Dipakai sekarang' : '\u00a0'}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="attract__wait">Menunggu pemain berikutnya...</p>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div className="booth-overlay">
            <div className="stage-label">Pose 1 dari {total}</div>
            <p className="stage-word">SIAP?</p>
          </div>
          <div className="booth-banner">Berdiri berdekatan dan bersiap berpose</div>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <div className="booth-overlay">
            <div className="stage-label">
              Pose {cur} dari {total}
            </div>
            <p className="stage-big" key={state.count}>
              {state.count}
            </p>
          </div>
          <div className="booth-banner">Lihat ke arah kamera dan tersenyum</div>
        </>
      )}

      {phase === 'flash' && state.cfg?.flashEffect && <div className="booth-flash" />}

      {(phase === 'between' || phase === 'assembling') && (
        <>
          <div className="booth-overlay" style={{ background: 'rgba(0,0,0,0.15)', justifyContent: 'flex-start', paddingTop: 40 }}>
            <div className="stage-label">Pose {cur} tersimpan</div>
          </div>
          <div className="booth-banner">
            {phase === 'assembling' || !hasNext ? 'Semua pose selesai · menyusun strip...' : `Ganti gaya! Pose berikutnya dalam ${state.count}`}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- hasil

const STRIP_BOX_W = 520;
const STRIP_BOX_MAX_H = 780;

/** Strip hasil rakitan dengan nomor slot di atasnya; saat retake slot lain diredupkan. */
function StripComposed({ state, frame }: { state: PublicState; frame: FrameInfo }) {
  const scale = Math.min(STRIP_BOX_W / frame.width, STRIP_BOX_MAX_H / frame.height);
  const w = Math.round(frame.width * scale);
  const h = Math.round(frame.height * scale);
  const no = state.sessionNo!;
  const retaking = state.phase === 'retake_intro' ? state.retaking : [];

  return (
    <div className="strip-image" style={{ width: w, height: h }}>
      <img className="strip-image__img" src={sessionFileUrl(no, 'strip.png', state.stripRev)} alt="" draggable={false} />
      {frame.slots.map((s, i) => {
        const slot = i + 1;
        const box = { left: s.x * scale, top: s.y * scale, width: s.width * scale, height: s.height * scale };
        const isRetake = retaking.includes(slot);
        return (
          <div key={slot} className="strip-image__slot" style={box}>
            {retaking.length > 0 && !isRetake && <div className="strip-image__dim" />}
            {isRetake && <div className="strip-image__focus" />}
            {isRetake && <span className="strip-image__tag nowrap">Ulang #{slot}</span>}
            <SlotBadge number={slot} style={{ left: 6, top: 6 }} />
          </div>
        );
      })}
    </div>
  );
}

function ResultScreen({ state }: { state: PublicState }) {
  const no = state.sessionNo!;
  const label = formatSessionNo(no);
  const hasStrip = state.frame !== null && state.stripRev > 0;

  return (
    <div className="result">
      {hasStrip ? (
        <StripComposed state={state} frame={state.frame!} />
      ) : (
        <div className="strip-fallback">
          {Array.from({ length: state.slotCount }, (_, i) => (
            <div key={i} className="strip-fallback__item">
              <img src={sessionFileUrl(no, `slot-${i + 1}.jpg`, state.slotRevs[i] ?? 0)} alt="" draggable={false} />
              <SlotBadge number={i + 1} style={{ left: 6, top: 6 }} />
            </div>
          ))}
        </div>
      )}
      <ResultInfo state={state} label={label} />
    </div>
  );
}

function ShotTiles({ count, active }: { count: number; active?: number[] }) {
  return (
    <div className="shot-tiles">
      {Array.from({ length: count }, (_, i) => {
        const slot = i + 1;
        const cls = !active ? 'shot-tile' : active.includes(slot) ? 'shot-tile shot-tile--active' : 'shot-tile shot-tile--dim';
        return (
          <div key={slot} className={cls}>
            {slot}
          </div>
        );
      })}
    </div>
  );
}

const joinSlots = (slots: number[]): string =>
  slots.length <= 1 ? String(slots[0] ?? '') : `${slots.slice(0, -1).join(', ')} dan ${slots[slots.length - 1]}`;

function ResultInfo({ state, label }: { state: PublicState; label: string }) {
  const driveOn = state.drive.configured;
  switch (state.phase) {
    case 'review':
      return (
        <div className="result-info">
          <p className="result-tag">Preview Hasil</p>
          <p className="result-head">{state.slotCount} Pose Selesai</p>
          <p className="result-body">Puas dengan hasilnya? Mau ulang pose tertentu? Sebutkan nomor pose ke operator.</p>
          <div className="retake-hint">
            <p className="retake-hint__label">Mau ulang pose yang mana?</p>
            <ShotTiles count={state.slotCount} />
          </div>
        </div>
      );

    case 'retake_intro': {
      const list = state.retaking;
      return (
        <div className="result-info">
          <p className="result-tag">Ulang Pose</p>
          <p className="result-head">Ulang {list.map((s) => `#${s}`).join(' ')}</p>
          <p className="result-body">
            {list.length === 1
              ? `Bersiaplah! Kamera akan menghitung mundur lagi untuk pose nomor ${list[0]}.`
              : `Bersiaplah! Kamera akan menghitung mundur lagi untuk pose ${joinSlots(list)}.`}
          </p>
          <div className="retake-hint">
            <p className="retake-hint__label">Sedang diulang</p>
            <ShotTiles count={state.slotCount} active={list} />
          </div>
        </div>
      );
    }

    case 'saving': {
      const progress = state.savingStep / 3;
      return (
        <div className="result-info">
          <p className="result-tag">Menyimpan</p>
          <p className="result-head">Menyimpan...</p>
          <p className="result-body">
            {driveOn ? 'Menyusun stripmu dan mengirimnya ke cloud. Sebentar lagi!' : 'Menyusun stripmu dan menyimpannya. Sebentar lagi!'}
          </p>
          <div className="progress-block">
            <span>{`Menyimpan... ${Math.round(progress * 100)}%`}</span>
            <Progress stage value={progress} />
          </div>
        </div>
      );
    }

    case 'saved':
      if (state.savedOffline) {
        return (
          <div className="result-info">
            <p className="result-tag result-tag--bad">Tidak Ada Internet</p>
            <p className="result-head">Foto Tersimpan di Laptop</p>
            <p className="result-body">
              Tenang! Stripmu aman dan akan diunggah otomatis begitu internet kembali. Ingat nomor fotomu:
            </p>
            <div className="photo-number">PHOTO #{label}</div>
          </div>
        );
      }
      return (
        <div className="result-info">
          <p className="result-tag result-tag--done">Selesai</p>
          <p className="result-head">Tersimpan!</p>
          <p className="result-body">
            {driveOn ? 'Cari stripmu di folder Drive bersama dengan nomor ini:' : 'Stripmu sudah tersimpan. Ingat nomor fotomu:'}
          </p>
          <div className="photo-number">PHOTO #{label}</div>
        </div>
      );

    default:
      return null;
  }
}
