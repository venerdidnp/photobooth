import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameInfo, Settings } from '../../../shared/protocol';
import { DEMO_CAMERA_ID, listCameras, loadCameraId, saveCameraId, useCamera } from '../lib/camera';
import { api, useServer } from '../lib/server';
import { unlockAudioOnInteraction } from '../lib/sfx';
import { useWakeLock } from '../lib/wakelock';
import { ControlPage } from './ControlPage';
import { Header, Toast, type AdminCtx, type Tab } from './parts';
import { QueuePage } from './QueuePage';
import { SettingsPage } from './SettingsPage';

const ESC_HINT = 'Tekan ESC sekali lagi untuk membatalkan sesi';

const isTab = (v: string): v is Tab => ['control', 'queue', 'settings'].includes(v);

/**
 * Panel operator di laptop (responsif).
 * Pintasan: SPASI mulai, 1-9 pilih pose yang diulang, ENTER ulang/selesai, ESC dua kali batalkan.
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
  useWakeLock();

  const phase = state?.phase;
  const sessionRunning = phase !== undefined && phase !== 'idle';
  // Webcam hanya bisa dipegang satu pemilik. Bila layar tamu (/booth) terhubung, dialah pemiliknya:
  // panel tidak boleh ikut membuka kamera (kalau tidak, salah satunya mati). Panel hanya membuka kamera
  // sendiri saat tidak ada layar tamu (uji coba), idle, dan di tab Control.
  const boothConnected = state?.booth ?? true;
  const preview = useCamera(cameraId, tab === 'control' && !sessionRunning && !boothConnected);

  // --- daftar kamera + ingat pilihan terakhir
  const refreshDevices = useCallback(() => {
    return listCameras()
      .then((list) => {
        setDevices(list);
        // 'demo' bukan perangkat nyata: tetap dipertahankan walau tidak ada di daftar
        setCameraId((cur) =>
          cur === DEMO_CAMERA_ID || (cur && list.some((d) => d.deviceId === cur)) ? cur : (list[0]?.deviceId ?? null),
        );
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

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
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const saveSettingsRef = useRef(saveSettings);
  saveSettingsRef.current = saveSettings;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === ' ' && s.phase === 'idle') {
        e.preventDefault();
        send({ type: 'start' });
      } else if (e.key.toLowerCase() === 'f' && s.phase === 'idle' && framesRef.current.length > 1) {
        // ganti ke frame berikutnya (berputar)
        const list = framesRef.current;
        const i = list.findIndex((f) => f.id === s.frame?.id);
        saveSettingsRef.current({ frameId: list[(i + 1) % list.length]!.id });
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
          setToast(ESC_HINT);
          window.setTimeout(() => setToast((t) => (t === ESC_HINT ? null : t)), 2000);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  if (!state) {
    return (
      <div className="op">
        <p className="op-main muted">{connected ? 'Memuat...' : 'Menyambung ke server...'}</p>
      </div>
    );
  }

  const ctx: AdminCtx = {
    state,
    send,
    frames,
    saveSettings,
    goTab: changeTab,
    camera: {
      devices,
      selectedId: cameraId,
      select: selectCamera,
      refresh: () => void refreshDevices(),
      stream: preview.stream,
      error: preview.error,
    },
  };

  let page;
  if (tab === 'queue') page = <QueuePage ctx={ctx} />;
  else if (tab === 'settings') page = <SettingsPage ctx={ctx} />;
  else page = <ControlPage ctx={ctx} />;

  return (
    <div className="op">
      <Header tab={tab} onTab={changeTab} state={state} />
      <main className="op-main">{page}</main>
      <Toast text={toast} />
    </div>
  );
}
