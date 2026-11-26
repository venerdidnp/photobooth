import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicState, ServerMsg } from '../../../shared/protocol';
import { LiveVideo } from '../components/LiveVideo';
import { Stage } from '../components/Stage';
import { captureFrame, useCamera } from '../lib/camera';
import { composeStrip } from '../lib/compose';
import { sessionFileUrl, useServer } from '../lib/server';
import { sfx, unlockAudioOnInteraction } from '../lib/sfx';
import { BoothScreen } from './BoothScreen';

async function upload(url: string, blob: Blob, type: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: blob });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Layar tamu di monitor eksternal. Hanya untuk dilihat (tidak ada elemen interaktif).
 * Tugasnya selain menampilkan state: memegang webcam, menjepret saat server memerintah, dan merakit strip.
 */
export function BoothApp() {
  const stateRef = useRef<PublicState | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sendRef = useRef<ReturnType<typeof useServer>['send'] | null>(null);
  const [localShot, setLocalShot] = useState<{ slot: number; url: string } | null>(null);

  const handleMessage = useCallback((msg: ServerMsg) => {
    const send = sendRef.current;
    if (!send) return;

    if (msg.type === 'capture') {
      if (stateRef.current?.settings.sound) sfx.shutter();
      void (async () => {
        try {
          const video = videoRef.current;
          if (!video) throw new Error('video tidak tersedia');
          const blob = await captureFrame(video);
          const url = URL.createObjectURL(blob);
          setLocalShot((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return { slot: msg.slot, url };
          });
          const ok = await upload(`/api/sessions/${msg.sessionNo}/shots/${msg.slot}`, blob, 'image/jpeg');
          if (!ok) send({ type: 'shot.failed', slot: msg.slot, reason: 'upload gagal' });
        } catch (err) {
          send({ type: 'shot.failed', slot: msg.slot, reason: err instanceof Error ? err.message : String(err) });
        }
      })();
    }

    if (msg.type === 'assemble') {
      void (async () => {
        try {
          const frame = stateRef.current?.frame;
          if (!frame || frame.id !== msg.frameId) throw new Error('frame tidak cocok');
          const urls = msg.slotRevs.map((rev, i) => sessionFileUrl(msg.sessionNo, `slot-${i + 1}.jpg`, rev));
          const strip = await composeStrip(frame, urls);
          const ok = await upload(`/api/sessions/${msg.sessionNo}/strip`, strip, 'image/png');
          if (!ok) send({ type: 'strip.failed', reason: 'upload gagal' });
        } catch (err) {
          send({ type: 'strip.failed', reason: err instanceof Error ? err.message : String(err) });
        }
      })();
    }
  }, []);

  const { state, connected, send } = useServer('booth', handleMessage);
  sendRef.current = send;
  stateRef.current = state;

  const { stream, error } = useCamera(state?.cameraId ?? null);

  // laporkan status kamera ke server (operator melihatnya di panel)
  useEffect(() => {
    if (connected) send({ type: 'camera.status', ok: stream !== null && !error, error: error ?? undefined });
  }, [connected, stream, error, send]);

  useEffect(() => unlockAudioOnInteraction(), []);

  // suara hitung mundur & selesai
  const phase = state?.phase;
  const count = state?.count;
  const sound = state?.settings.sound;
  useEffect(() => {
    if (!sound || count === undefined) return;
    if (phase === 'countdown') (count > 1 ? sfx.tick : sfx.lastTick)();
    if (phase === 'saved') sfx.done();
  }, [phase, count, sound]);

  // layar bersih tanpa kursor/seleksi; tidak ada yang bisa diklik
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', block);
    window.addEventListener('dragstart', block);
    return () => {
      window.removeEventListener('contextmenu', block);
      window.removeEventListener('dragstart', block);
    };
  }, []);

  if (!state) {
    return (
      <Stage width={1920} height={1080}>
        <div className="booth" />
      </Stage>
    );
  }

  const liveView = stream ? (
    <LiveVideo stream={stream} mirror={state.settings.mirrorPreview} videoRef={videoRef} />
  ) : (
    <>
      <LiveVideo stream={null} mirror={false} videoRef={videoRef} />
      <p className="booth-stage__empty">{error ? 'Kamera tidak tersedia' : 'Memulai kamera...'}</p>
    </>
  );

  return (
    <Stage width={1920} height={1080}>
      <BoothScreen
        state={state}
        liveView={liveView}
        localShotUrl={localShot && localShot.slot === state.current ? localShot.url : null}
      />
    </Stage>
  );
}
