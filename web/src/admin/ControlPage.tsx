import { formatSessionNo, type PublicState } from '../../../shared/protocol';
import { BoothScreen } from '../booth/BoothScreen';
import { Button } from '../components/Button';
import { Keycap } from '../components/Keycap';
import { LiveVideo } from '../components/LiveVideo';
import { Panel } from '../components/Panel';
import { ScaleBox } from '../components/Stage';
import { StatusChip } from '../components/StatusChip';
import { GUEST_SCREEN, PHASE_LABEL, PixelArrow, TopBar, type AdminCtx } from './parts';

export function ControlPage({ ctx }: { ctx: AdminCtx }) {
  const { state } = ctx;
  return (
    <>
      <TopBar title="CONTROL ROOM" state={state} />
      <div className="admin-body">
        <div className="col col--500">
          <CameraPanel ctx={ctx} />
          <FramePanel ctx={ctx} />
        </div>
        <div className="col col--740">
          <SessionPanel ctx={ctx} />
          <MirrorPanel state={state} />
        </div>
      </div>
    </>
  );
}

function CameraPanel({ ctx }: { ctx: AdminCtx }) {
  const { camera, state } = ctx;
  const idle = state.phase === 'idle';
  const connected = camera.stream !== null;
  return (
    <Panel title="CAMERA">
      <p className="t-label-s is-soft nowrap">SELECT WEBCAM</p>
      <div className="select-wrap">
        <select
          className="select"
          value={camera.selectedId ?? ''}
          disabled={!idle}
          onChange={(e) => camera.select(e.target.value)}
          aria-label="Select webcam"
        >
          {camera.devices.length === 0 && <option value="">No webcam found</option>}
          {camera.devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
        <PixelArrow />
      </div>
      <div className="camera-preview">
        {idle ? (
          <LiveVideo stream={camera.stream} mirror={state.settings.mirrorPreview} className="camera-preview__video" />
        ) : (
          <p className="viewfinder__empty t-label-s">PREVIEW PAUSED DURING SESSION</p>
        )}
        <div className="camera-preview__border" />
        <StatusChip className="camera-preview__chip" tone={connected || !idle ? 'turquoise' : 'danger'}>
          {!idle ? 'IN USE' : connected ? 'CONNECTED' : camera.error ? 'NO CAMERA' : 'STARTING'}
        </StatusChip>
      </div>
      {state.boothCamera && !state.boothCamera.ok && (
        <p className="empty-note">Guest display cannot open the camera. Check the webcam.</p>
      )}
    </Panel>
  );
}

function FramePanel({ ctx }: { ctx: AdminCtx }) {
  const { frames, state, saveSettings } = ctx;
  const idle = state.phase === 'idle';
  const selectedId = state.frame?.id ?? null;
  return (
    <Panel title="FRAME">
      {frames.length === 0 ? (
        <p className="empty-note">No frames yet. Put a PNG + JSON in the frames folder.</p>
      ) : (
        <div className="frame-options">
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
                  <img className="frame-thumb__img" src={f.imageUrl} alt="" draggable={false} />
                  <span className="frame-thumb__border" />
                </span>
                <span className="nowrap">{f.name.toUpperCase()}</span>
                {selected && <span className="tag">IN USE</span>}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function SessionPanel({ ctx }: { ctx: AdminCtx }) {
  const { state, send, frames } = ctx;
  const idle = state.phase === 'idle';
  const frame = state.frame ?? frames[0] ?? null;
  const canStart = idle && state.booth && frame !== null;
  const cancellable = !idle && state.phase !== 'saving' && state.phase !== 'saved';

  return (
    <Panel title="SESSION">
      <div className="row">
        <StatusChip tone={idle ? 'yellow' : 'orange'}>{PHASE_LABEL[state.phase]}</StatusChip>
        <p className="t-label-m nowrap">
          {idle
            ? `NEXT PHOTO #${formatSessionNo(state.nextNo)}`
            : `PHOTO #${formatSessionNo(state.sessionNo ?? 0)}${state.current ? ` - SHOT ${state.current}/${state.slotCount}` : ''}`}
        </p>
      </div>

      {idle ? (
        <>
          <Button variant="primary" size="xl" block disabled={!canStart} onMouseDown={(e) => e.preventDefault()} onClick={() => send({ type: 'start' })}>
            START SESSION
          </Button>
          <div className="key-hint">
            <span className="t-label-s is-soft">PRESS</span>
            <Keycap label="SPACE" />
            <span className="t-label-s is-soft nowrap">TO START A NEW SESSION</span>
          </div>
          {!state.booth && <p className="empty-note">Open the guest display (/booth) on the external monitor first.</p>}
        </>
      ) : (
        <>
          <p className="t-body-l">Session in progress. The guest is following the big screen.</p>
          <Button variant="danger" size="sm" block disabled={!cancellable} onMouseDown={(e) => e.preventDefault()} onClick={() => send({ type: 'cancel' })}>
            CANCEL SESSION
          </Button>
          <div className="key-hint">
            <span className="t-label-s is-soft">PRESS</span>
            <Keycap label="ESC" />
            <span className="t-label-s is-soft nowrap">TWICE TO CANCEL</span>
          </div>
        </>
      )}

      <div className="tiles">
        <Tile label="SHOTS" value={String(frame?.slots.length ?? '-')} />
        <Tile label="COUNTDOWN" value={`${state.settings.countdownSec} SEC`} />
        <Tile label="FRAME" value={(frame?.name ?? '-').toUpperCase()} />
      </div>
    </Panel>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <span className="t-label-s is-soft">{label}</span>
      <span className="t-title-s">{value}</span>
    </div>
  );
}

function MirrorPanel({ state }: { state: PublicState }) {
  return (
    <Panel title="GUEST DISPLAY MIRROR">
      <div className="mirror-row">
        <div className="mirror-monitor">
          <ScaleBox width={1920} height={1080} scale={461 / 1920}>
            <BoothScreen state={state} mirror liveView={<p className="viewfinder__empty t-label-m">LIVE</p>} />
          </ScaleBox>
          <div className="mirror-monitor__border" />
          <StatusChip className="mirror-monitor__chip" tone="orange">
            GUEST: {GUEST_SCREEN[state.phase]}
          </StatusChip>
        </div>
        <div className="mirror-info">
          <p className="t-label-s is-soft nowrap">SCREEN STATE</p>
          <p className="t-title-s nowrap">{GUEST_SCREEN[state.phase]}</p>
          <p className="t-label-s is-soft nowrap">RESOLUTION</p>
          <p className="t-body-l nowrap">1920 x 1080</p>
          <p className="t-body-m is-soft">This is what the guest sees on the big monitor.</p>
        </div>
      </div>
    </Panel>
  );
}
