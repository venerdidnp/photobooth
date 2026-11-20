import { formatSessionNo } from '../../../shared/protocol';
import { Button } from '../components/Button';
import { Keycap } from '../components/Keycap';
import { Panel } from '../components/Panel';
import { SlotBadge } from '../components/SlotBadge';
import { StatusChip } from '../components/StatusChip';
import { sessionFileUrl } from '../lib/server';
import { TopBar, type AdminCtx } from './parts';

/** O2: operator memilih slot yang diulang (boleh lebih dari satu), lalu mengulang atau menyelesaikan. */
export function ReviewPage({ ctx }: { ctx: AdminCtx }) {
  const { state, send } = ctx;
  const no = state.sessionNo ?? 0;
  const selection = state.retakeSelection;
  const hasSelection = selection.length > 0;
  const noPrevent = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <>
      <TopBar title="REVIEW & FINISH" state={state} />
      <div className="admin-body">
        <Panel title="SHOT REVIEW" className="review-panel">
          {Array.from({ length: state.slotCount }, (_, i) => {
            const slot = i + 1;
            const picked = selection.includes(slot);
            return (
              <div key={slot} className="shot-row">
                <div className="shot-thumb">
                  <img
                    className="shot-thumb__img"
                    src={sessionFileUrl(no, `slot-${slot}.jpg`, state.slotRevs[i] ?? 0)}
                    alt=""
                    draggable={false}
                  />
                  <div className="shot-thumb__border" />
                  <SlotBadge number={slot} style={{ position: 'absolute', left: 6, top: 6 }} />
                </div>
                <div className="shot-info">
                  <p className="t-label-l nowrap">SHOT {slot}</p>
                  <StatusChip tone={picked ? 'orange' : 'turquoise'}>{picked ? 'RETAKE' : 'KEPT'}</StatusChip>
                </div>
                <div className="retake-action">
                  <Button
                    variant={picked ? 'primary' : 'secondary'}
                    style={{ minWidth: 198 }} /* lebar tetap supaya baris tidak bergeser saat di-toggle */
                    onMouseDown={noPrevent}
                    onClick={() => send({ type: 'retake.toggle', slot })}
                    aria-pressed={picked}
                  >
                    {picked ? `UNDO ${slot}` : `RETAKE ${slot}`}
                  </Button>
                  <div className="key-hint key-hint--tight">
                    <span className="t-label-s is-soft">KEY</span>
                    <Keycap label={String(slot)} />
                  </div>
                </div>
              </div>
            );
          })}
        </Panel>

        <div className="col col--500">
          <Panel title="SESSION">
            <div className="row">
              <StatusChip tone="orange">REVIEW</StatusChip>
              <p className="t-label-m nowrap">PHOTO #{formatSessionNo(no)}</p>
            </div>
            <p className="t-body-l full">
              {hasSelection
                ? `Ready to retake shot ${selection.join(' & ')}. Only those shots will be redone.`
                : 'Guest is checking the strip on the big screen.'}
            </p>

            {hasSelection && (
              <>
                <Button variant="primary" size="lg" block onMouseDown={noPrevent} onClick={() => send({ type: 'retake.start' })}>
                  {`RETAKE ${selection.join(' & ')}`}
                </Button>
                <div className="key-hint">
                  <span className="t-label-s is-soft">PRESS</span>
                  <Keycap label="ENTER" />
                </div>
              </>
            )}

            <Button variant="success" size="lg" block disabled={hasSelection} onMouseDown={noPrevent} onClick={() => send({ type: 'finish' })}>
              FINISH & UPLOAD
            </Button>
            {!hasSelection && (
              <div className="key-hint">
                <span className="t-label-s is-soft">PRESS</span>
                <Keycap label="ENTER" />
              </div>
            )}

            <Button variant="danger" size="sm" block onMouseDown={noPrevent} onClick={() => send({ type: 'cancel' })}>
              CANCEL SESSION
            </Button>
            <div className="key-hint">
              <span className="t-label-s is-soft">PRESS</span>
              <Keycap label="ESC" />
              <span className="t-label-s is-soft nowrap">TWICE</span>
            </div>
          </Panel>

          {/* disembunyikan saat ada slot terpilih: kolom ini sudah penuh dan TIP akan terpotong */}
          {!hasSelection && (
            <Panel title="TIP">
              <p className="t-body-l full">
                Finishing saves the strip on this laptop first, then uploads it to Google Drive in the background.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
