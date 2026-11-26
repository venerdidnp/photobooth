import type { ReactNode } from 'react';
import { formatSessionNo, type FrameInfo, type PublicState } from '../../../shared/protocol';
import { PixelLogo, Sparkle } from '../components/Pixel';
import { ScenePhoto } from '../components/ScenePhoto';
import { countdownFill, SegmentedBar } from '../components/SegmentedBar';
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
}

/**
 * Seluruh tampilan tamu 1920x1080 (Figma G1-G9) sebagai fungsi dari state server.
 * Murni tampilan: tidak ada tombol/tautan.
 */
export function BoothScreen({ state, liveView, localShotUrl, mirror }: Props) {
  let body: ReactNode;
  switch (state.phase) {
    case 'idle':
      body = <AttractScreen />;
      break;
    case 'ready':
    case 'countdown':
    case 'flash':
    case 'between':
    case 'assembling':
      body = <CaptureScreen state={state} liveView={liveView} localShotUrl={localShotUrl} />;
      break;
    default:
      body = <ResultScreen state={state} />;
  }

  return (
    <div className={mirror ? 'booth booth--mirror' : 'booth'} onContextMenu={(e) => e.preventDefault()}>
      <ScenePhoto />
      {state.phase !== 'idle' && <Header sessionNo={state.sessionNo} />}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- G1 Attract

function AttractScreen() {
  return (
    <>
      <div className="attract-title">
        <div className="attract-tagline t-label-m">PHOTOBOOTH: 4-SHOT STRIP</div>
        <p className="attract-line">DIES NATALIS</p>
        <p className="attract-line attract-line--accent">INFORMATIKA KE-6</p>
      </div>
      <p className="attract-press t-title-l">{'>> PRESS START <<'}</p>
      <p className="attract-wait">WAITING FOR NEXT PLAYER...</p>
    </>
  );
}

function Header({ sessionNo }: { sessionNo: number | null }) {
  return (
    <div className="booth-header">
      <div className="booth-logo">
        <PixelLogo />
        <span className="t-title-s nowrap">DIES NATALIS INFORMATIKA KE-6</span>
      </div>
      {sessionNo !== null && (
        <div className="booth-session-chip t-label-m nowrap">SESSION #{formatSessionNo(sessionNo)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- G2-G5 capture

interface CaptureText {
  tag: string;
  head: string;
  label: string;
  hint: string;
  instruction: string;
}

function captureText(state: PublicState, cur: number): CaptureText {
  const hasNext = state.queue.length > 0;
  switch (state.phase) {
    case 'ready':
      return {
        tag: 'PHASE 1: GET READY',
        head: 'GET READY!',
        label: 'STARTING IN...',
        hint: 'Stand close together and get ready to pose!',
        instruction: 'STRIKE A POSE!',
      };
    case 'countdown':
      return {
        tag: 'PHASE 2: CAPTURE',
        head: 'SMILE!',
        label: `SHOT ${cur} IN...`,
        hint: 'Look at the lens and smile big!',
        instruction: 'LOOK AT THE LENS',
      };
    case 'flash':
      return {
        tag: 'PHASE 2: CAPTURE',
        head: 'SNAP!',
        label: 'FLASH!',
        hint: 'Hold the pose for one more moment!',
        instruction: 'HOLD IT!',
      };
    case 'between':
      return hasNext
        ? {
            tag: 'PHASE 2: CAPTURE',
            head: 'NICE ONE!',
            label: `NEXT SHOT IN ${state.count}`,
            hint: 'Change your pose. Next shot is coming up!',
            instruction: 'CHANGE YOUR POSE!',
          }
        : {
            tag: 'PHASE 2: CAPTURE',
            head: 'NICE ONE!',
            label: 'ALL SHOTS DONE!',
            hint: 'Great job! Hang on while we build your strip.',
            instruction: 'ALL DONE!',
          };
    default:
      return {
        tag: 'PHASE 2: CAPTURE',
        head: 'NICE ONE!',
        label: 'BUILDING YOUR STRIP...',
        hint: 'Great job! Hang on while we build your strip.',
        instruction: 'ALL DONE!',
      };
  }
}

function CaptureScreen({
  state,
  liveView,
  localShotUrl,
}: {
  state: PublicState;
  liveView?: ReactNode;
  localShotUrl?: string | null;
}) {
  const cur = state.current ?? state.queue[0] ?? 1;
  const text = captureText(state, cur);
  const no = state.sessionNo!;
  const slotUrl = (slot: number) => sessionFileUrl(no, `slot-${slot}.jpg`, state.slotRevs[slot - 1] ?? 0);

  const filled =
    state.phase === 'flash' || state.phase === 'assembling'
      ? 10
      : countdownFill(state.count, state.total);

  const showLive = state.phase === 'ready' || state.phase === 'countdown' || state.phase === 'flash';
  const shotUrl = localShotUrl ?? ((state.slotRevs[cur - 1] ?? 0) > 0 ? slotUrl(cur) : null);

  return (
    <div className="capture">
      <div className="status-panel">
        <div className="status-top">
          <div className="phase-tag t-label-s nowrap">{text.tag}</div>
          <p className="status-head">{text.head}</p>
          <div className="shot-indicator">
            <p className="t-label-m is-soft">SHOT</p>
            <p className="shot-number">
              {cur}/{state.slotCount}
            </p>
            <div className="shot-squares">
              {Array.from({ length: state.slotCount }, (_, i) => {
                const slot = i + 1;
                const on = state.isRetake ? !state.queue.includes(slot) : slot <= cur;
                return <span key={slot} className={on ? 'shot-square shot-square--on' : 'shot-square'} />;
              })}
            </div>
          </div>
        </div>
        <div className="status-bottom">
          <p className="t-label-s is-soft nowrap">{text.label}</p>
          <SegmentedBar filled={filled} />
          <div className="hint">{text.hint}</div>
        </div>
      </div>

      <div className="camera-column">
        <div className="viewfinder">
          {showLive ? liveView : shotUrl && <img className="viewfinder__media" src={shotUrl} alt="" draggable={false} />}
          {state.phase === 'flash' && state.cfg?.flashEffect && <div className="viewfinder__flash" />}
          <span className="bracket bracket--tl" />
          <span className="bracket bracket--tr" />
          <span className="bracket bracket--bl" />
          <span className="bracket bracket--br" />
          {showLive && (
            <div className="live-tag t-label-s">
              <span className="live-tag__dot" />
              LIVE
            </div>
          )}
          {state.phase === 'ready' && <p className="viewfinder__big viewfinder__big--word" style={{ color: 'var(--brand-yellow)' }}>READY?</p>}
          {state.phase === 'countdown' && <p className="viewfinder__big viewfinder__big--digit" style={{ color: 'var(--brand-yellow)' }}>{state.count}</p>}
          {state.phase === 'flash' && <p className="viewfinder__big viewfinder__big--word" style={{ color: 'var(--brand-pink-strong)' }}>SNAP!</p>}
          {(state.phase === 'between' || state.phase === 'assembling') && (
            <div className="ribbon t-label-l">SHOT {cur} SAVED!</div>
          )}
          <div className="viewfinder__border" />
        </div>
        <div className="instruction-bar t-label-l">{text.instruction}</div>
      </div>

      <div className="strip-panel">
        <p className="t-label-s nowrap">PHOTO STRIP</p>
        {Array.from({ length: state.slotCount }, (_, i) => {
          const slot = i + 1;
          const isCurrent = slot === cur && state.phase !== 'between' && state.phase !== 'assembling';
          const waiting = state.queue.includes(slot);
          const hasPhoto = (state.slotRevs[i] ?? 0) > 0 && !waiting && !isCurrent;
          const kind = isCurrent ? 'current' : hasPhoto ? 'filled' : 'empty';
          return (
            <div key={slot} className={`slot slot--${kind}`}>
              {kind === 'filled' && <img className="slot__photo" src={slotUrl(slot)} alt="" draggable={false} />}
              {kind === 'current' && <p className="slot__text slot__text--current t-label-m">SHOOTING...</p>}
              {kind === 'empty' && <p className="slot__text t-label-s is-soft">WAITING</p>}
              <div className="slot__border" />
              <SlotBadge number={slot} style={{ position: 'absolute', left: 8, top: 8 }} />
            </div>
          );
        })}
        <p className="t-label-s is-soft" style={{ whiteSpace: 'pre' }}>
          {`INFORMATIKA 6  #${formatSessionNo(no)}`}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- G6-G9 hasil

const STRIP_BOX_W = 288;
const STRIP_BOX_MAX_H = 720;

/** Strip hasil rakitan dengan nomor slot di atasnya; saat retake slot lain diredupkan. */
function StripComposed({ state, frame }: { state: PublicState; frame: FrameInfo }) {
  const scale = Math.min(STRIP_BOX_W / frame.width, STRIP_BOX_MAX_H / frame.height);
  const w = Math.round(frame.width * scale);
  const h = Math.round(frame.height * scale);
  const no = state.sessionNo!;
  const retaking = state.phase === 'retake_intro' ? state.retaking : [];

  return (
    <div className="strip-image" style={{ width: w, height: h }}>
      <img
        className="strip-image__img"
        src={sessionFileUrl(no, 'strip.png', state.stripRev)}
        alt=""
        draggable={false}
      />
      {frame.slots.map((s, i) => {
        const slot = i + 1;
        const box = { left: s.x * scale, top: s.y * scale, width: s.width * scale, height: s.height * scale };
        const isRetake = retaking.includes(slot);
        return (
          <div key={slot} className="strip-image__slot" style={box}>
            {retaking.length > 0 && !isRetake && <div className="strip-image__dim" />}
            {isRetake && <div className="strip-image__focus" />}
            {isRetake && <span className="strip-image__tag t-label-s nowrap">RETAKE #{slot}</span>}
            <SlotBadge number={slot} style={{ position: 'absolute', left: 8, top: 8 }} />
          </div>
        );
      })}
    </div>
  );
}

function ResultScreen({ state }: { state: PublicState }) {
  const no = state.sessionNo!;
  const label = formatSessionNo(no);
  const driveOn = state.drive.configured;
  const isSaved = state.phase === 'saved';
  const hasStrip = state.frame !== null && state.stripRev > 0;

  return (
    <>
      <div className={isSaved ? 'result result--saved' : 'result'}>
        <ResultPanel state={state} label={label} driveOn={driveOn} />
        <div className="strip-panel">
          <p className="t-label-s nowrap">PHOTO STRIP</p>
          {hasStrip ? (
            <StripComposed state={state} frame={state.frame!} />
          ) : (
            Array.from({ length: state.slotCount }, (_, i) => (
              <div key={i} className="slot slot--filled">
                <img
                  className="slot__photo"
                  src={sessionFileUrl(no, `slot-${i + 1}.jpg`, state.slotRevs[i] ?? 0)}
                  alt=""
                  draggable={false}
                />
                <div className="slot__border" />
                <SlotBadge number={i + 1} style={{ position: 'absolute', left: 8, top: 8 }} />
              </div>
            ))
          )}
          <p className="t-label-s is-soft" style={{ whiteSpace: 'pre' }}>
            {`INFORMATIKA 6  #${label}`}
          </p>
        </div>
      </div>
      {(state.phase === 'review' || (isSaved && !state.savedOffline)) && (
        <>
          <Sparkle left={1418} top={168} size={44} color="yellow" />
          <Sparkle left={1842} top={502} size={36} color="pink" />
          <Sparkle left={1480} top={990} size={40} color="turquoise" />
          <Sparkle left={1815} top={925} size={30} color="yellow" />
        </>
      )}
    </>
  );
}

function ShotTiles({ count, active }: { count: number; active?: number[] }) {
  return (
    <div className="shot-tiles">
      {Array.from({ length: count }, (_, i) => {
        const slot = i + 1;
        const cls = !active
          ? 'shot-tile'
          : active.includes(slot)
            ? 'shot-tile shot-tile--active'
            : 'shot-tile shot-tile--dim';
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
  slots.length <= 1 ? String(slots[0] ?? '') : `${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]}`;

function ResultPanel({ state, label, driveOn }: { state: PublicState; label: string; driveOn: boolean }) {
  switch (state.phase) {
    case 'review':
      return (
        <div className="result-panel">
          <div className="result-tag t-label-m nowrap">PHASE 3: REVIEW</div>
          <p className="result-head">NICE SHOTS!</p>
          <p className="result-body">
            Happy with your strip? Want to redo a pose? Tell the operator the shot number.
          </p>
          <div className="retake-hint">
            <p className="t-label-m is-soft nowrap">RETAKE WHICH SHOT?</p>
            <ShotTiles count={state.slotCount} />
          </div>
        </div>
      );

    case 'retake_intro': {
      const list = state.retaking;
      return (
        <div className="result-panel">
          <div className="result-tag t-label-m nowrap">PHASE 3: RETAKE</div>
          <p className="result-head">RETAKE {list.map((s) => `#${s}`).join(' ')}</p>
          <p className="result-body">
            {list.length === 1
              ? `Get ready! The camera will count down again for shot number ${list[0]}.`
              : `Get ready! The camera will count down again for shots ${joinSlots(list)}.`}
          </p>
          <div className="retake-hint">
            <p className="t-label-m is-soft nowrap">NOW RETAKING</p>
            <ShotTiles count={state.slotCount} active={list} />
          </div>
        </div>
      );
    }

    case 'saving': {
      const pct = Math.round((state.savingStep / 3) * 100);
      return (
        <div className="result-panel">
          <div className="result-tag t-label-m nowrap">PHASE 4: SAVING</div>
          <p className="result-head">SAVING...</p>
          <p className="result-body">
            {driveOn
              ? 'Building your strip and sending it to the cloud. Almost there!'
              : 'Building your strip and saving it. Almost there!'}
          </p>
          <div className="progress-block">
            <p className="t-label-m is-soft" style={{ whiteSpace: 'pre' }}>{`SAVING...  ${pct}%`}</p>
            <SegmentedBar filled={(state.savingStep / 3) * 10} />
          </div>
        </div>
      );
    }

    case 'saved':
      if (state.savedOffline) {
        return (
          <div className="result-panel">
            <div className="result-tag result-tag--danger t-label-m nowrap">NO INTERNET</div>
            <p className="result-head result-head--plain">PHOTO SAVED LOCALLY</p>
            <p className="result-body">
              No worries! Your strip is safe and will upload by itself when the internet is back.
            </p>
            <div className="offline-status">
              <div className="offline-status__icon">!</div>
              <div className="offline-status__text">
                <p className="t-label-l">PHOTO #{label}</p>
                <p className="t-label-s is-soft">WAITING FOR CONNECTION</p>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="result-panel result-panel--wide">
          <div className="result-tag result-tag--done t-label-m nowrap">DONE!</div>
          <p className="result-head result-head--success">SAVED!</p>
          <p className="result-body">
            {driveOn
              ? 'Find your strip in the shared Drive folder using this number:'
              : 'Your strip is saved. Remember your photo number:'}
          </p>
          <div className="photo-number">PHOTO #{label}</div>
        </div>
      );

    default:
      return null;
  }
}
