import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameInfo, Settings } from '../../../shared/protocol';
import { Stage } from '../components/Stage';
import { listCameras, loadCameraId, saveCameraId, useCamera } from '../lib/camera';
import { api, useServer } from '../lib/server';
import { unlockAudioOnInteraction } from '../lib/sfx';
import { ControlPage } from './ControlPage';
import { GalleryPage } from './GalleryPage';
import { Sidebar, Toast, type AdminCtx, type Tab } from './parts';
import { QueuePage } from './QueuePage';
import { ReviewPage } from './ReviewPage';
import { SettingsPage } from './SettingsPage';

const isTab = (v: string): v is Tab => ['control', 'queue', 'gallery', 'settings'].includes(v);

/**
 * Panel operator di laptop. Layar tetap 1440x900 yang diskalakan ke jendela.
 * Pintasan: SPACE mulai, 1-9 pilih slot ulang, ENTER ulang/selesai, ESC dua kali batalkan.
 */
export function AdminApp() {
  const { state, connected, send } = useServer('admin');
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return isTab(h) ? h : 'control';
  });
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(() => loadCameraId());
  const [toast, setToast] = useState<string | null>(null);
  const escAt = useRef(0);

  const phase = state?.phase;
  const sessionRunning = phase !== undefined && phase !== 'idle';
  // webcam hanya dibuka di panel saat idle & di tab Control, supaya tidak berebut dengan /booth
  const preview = useCamera(cameraId, tab === 'control' && !sessionRunning);

  // --- daftar kamera + ingat pilihan terakhir
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listCameras()
        .then((list) => {
          if (!alive) return;
          setDevices(list);
          setCameraId((cur) => (cur && list.some((d) => d.deviceId === cur) ? cur : (list[0]?.deviceId ?? null)));
        })
        .catch(() => undefined);
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, []);

  // beri tahu server (dan lewat server: /booth) kamera mana yang dipakai
  useEffect(() => {
    if (connected) send({ type: 'camera.select', deviceId: cameraId });
  }, [connected, cameraId, send]);

  const selectCamera = useCallback((id: string) => {
    saveCameraId(id);
    setCameraId(id);
  }, []);

  // --- frame & pengaturan
  const loadFrames = useCallback(() => {
    api<FrameInfo[]>('/api/frames').then(setFrames).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadFrames();
    const t = window.setInterval(loadFrames, 5000); // frame baru yang ditaruh di folder muncul sendiri
    return () => window.clearInterval(t);
  }, [loadFrames]);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    void api<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
  }, []);

  // --- tab: sinkron dengan hash, dan otomatis ke Control saat review
  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  }, []);
  useEffect(() => {
    if (phase === 'review') setTab('control');
  }, [phase]);

  useEffect(() => unlockAudioOnInteraction(), []);

  // --- notifikasi dari server
  const noticeId = state?.notice?.id;
  const noticeCode = state?.notice?.code;
  const noticeText = state?.notice?.text;
  useEffect(() => {
    if (!noticeId || noticeCode === 'BAD_STATE') return;
    setToast(noticeText ?? null);
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [noticeId, noticeCode, noticeText]);

  // --- pintasan keyboard
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === ' ' && s.phase === 'idle') {
        e.preventDefault();
        send({ type: 'start' });
      } else if (/^[1-9]$/.test(e.key) && s.phase === 'review') {
        send({ type: 'retake.toggle', slot: Number(e.key) });
      } else if (e.key === 'Enter' && s.phase === 'review') {
        e.preventDefault();
        send({ type: s.retakeSelection.length > 0 ? 'retake.start' : 'finish' });
      } else if (e.key === 'Escape' && s.phase !== 'idle' && s.phase !== 'saving' && s.phase !== 'saved') {
        const now = Date.now();
        if (now - escAt.current < 2000) {
          escAt.current = 0;
          setToast(null);
          send({ type: 'cancel' });
        } else {
          escAt.current = now;
          setToast('PRESS ESC AGAIN TO CANCEL THE SESSION');
          window.setTimeout(() => setToast((t) => (t === 'PRESS ESC AGAIN TO CANCEL THE SESSION' ? null : t)), 2000);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  if (!state) {
    return (
      <Stage width={1440} height={900}>
        <div className="admin">
          <p className="t-title-m" style={{ padding: 48 }}>
            {connected ? 'LOADING...' : 'CONNECTING TO SERVER...'}
          </p>
        </div>
      </Stage>
    );
  }

  const ctx: AdminCtx = {
    state,
    send,
    frames,
    saveSettings,
    camera: { devices, selectedId: cameraId, select: selectCamera, stream: preview.stream, error: preview.error },
  };

  let page;
  if (phase === 'review' && tab === 'control') page = <ReviewPage ctx={ctx} />;
  else if (tab === 'queue') page = <QueuePage ctx={ctx} />;
  else if (tab === 'gallery') page = <GalleryPage ctx={ctx} />;
  else if (tab === 'settings') page = <SettingsPage ctx={ctx} />;
  else page = <ControlPage ctx={ctx} />;

  return (
    <Stage width={1440} height={900}>
      <div className="admin">
        <Sidebar tab={tab} onTab={changeTab} />
        {page}
        <Toast text={toast} />
      </div>
    </Stage>
  );
}
