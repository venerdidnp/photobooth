import { useEffect, useState } from 'react';

const STORAGE_KEY = 'photobooth.cameraId';

/** id khusus untuk kamera simulasi (tanpa webcam), berguna untuk uji coba. */
export const DEMO_CAMERA_ID = 'demo';

/** Pilihan kamera terakhir (diingat di browser operator). */
export function loadCameraId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveCameraId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* mode privat / storage diblokir: abaikan */
  }
}

/**
 * Daftar semua webcam. Probe getUserMedia (untuk membuka label) HANYA dilakukan bila label belum terbaca,
 * karena probe membuka webcam sesaat dan bisa mematikan stream yang sedang dipegang halaman lain (/booth).
 */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  let all = await navigator.mediaDevices.enumerateDevices();
  let cams = all.filter((d) => d.kind === 'videoinput');
  if (cams.length > 0 && cams.some((d) => d.label === '')) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      all = await navigator.mediaDevices.enumerateDevices();
      cams = all.filter((d) => d.kind === 'videoinput');
    } catch {
      /* label tetap kosong; daftar tetap dipakai */
    }
  }
  return cams;
}

/** Stream simulasi 1280x720: gradien bergerak + lingkaran melayang + jam. Berhenti sendiri saat track dihentikan. */
function openDemoStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0]!;
  const t0 = performance.now();

  const draw = () => {
    if (track.readyState === 'ended') return;
    const t = (performance.now() - t0) / 1000;
    const g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, `hsl(${(t * 20) % 360}, 45%, 22%)`);
    g.addColorStop(1, `hsl(${(t * 20 + 90) % 360}, 45%, 38%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 3; i++) {
      const x = 640 + Math.sin(t * 0.8 + i * 2.1) * 360;
      const y = 360 + Math.cos(t * 0.6 + i * 1.7) * 180;
      ctx.beginPath();
      ctx.arc(x, y, 90 + i * 24, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.1 + i * 0.05})`;
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KAMERA SIMULASI', 640, 330);
    ctx.font = '400 28px system-ui, sans-serif';
    ctx.fillText(new Date().toLocaleTimeString('id-ID'), 640, 380);
    requestAnimationFrame(draw);
  };
  draw();
  return stream;
}

async function openStream(deviceId: string | null): Promise<MediaStream> {
  if (deviceId === DEMO_CAMERA_ID) return openDemoStream();
  const base: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...base, deviceId: { exact: deviceId } },
        audio: false,
      });
    } catch {
      /* perangkat tersimpan sudah tidak ada: pakai kamera bawaan */
    }
  }
  return navigator.mediaDevices.getUserMedia({ video: base, audio: false });
}

const RETRY_MS = 2000;
/** Berapa lama track boleh 'mute' sebelum kamera dibuka ulang. */
const MUTE_GRACE_MS = 4000;

/**
 * Buka webcam yang dipilih; lepas otomatis saat berganti/tidak dipakai.
 * Bila webcam terlepas/mati di tengah jalan (track 'ended'), stream dibuang, error dilaporkan,
 * dan kamera dicoba dibuka lagi setiap 2 detik sampai berhasil.
 */
export function useCamera(deviceId: string | null, enabled = true) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStream(null);
      return;
    }
    let cancelled = false;
    let current: MediaStream | null = null;
    let retryTimer: number | undefined;
    let muteTimer: number | undefined;
    const retryLater = () => {
      retryTimer = window.setTimeout(() => !cancelled && setAttempt((n) => n + 1), RETRY_MS);
    };
    /** Webcam mati/macet: lepas stream, laporkan, lalu coba buka lagi. */
    const died = (reason: string) => {
      if (cancelled) return;
      window.clearTimeout(muteTimer);
      current?.getTracks().forEach((t) => t.stop());
      current = null;
      setStream(null);
      setError(reason);
      retryLater();
    };

    openStream(deviceId)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current = s;
        setError(null);
        setStream(s);
        s.getVideoTracks().forEach((t) => {
          t.addEventListener('ended', () => died('camera disconnected'));
          // 'mute' = webcam berhenti mengirim gambar tanpa putus (mis. diambil aplikasi lain, USB tidur):
          // bila tidak pulih dalam beberapa detik, buka ulang kamera.
          t.addEventListener('mute', () => {
            window.clearTimeout(muteTimer);
            muteTimer = window.setTimeout(() => died('camera stopped sending video'), MUTE_GRACE_MS);
          });
          t.addEventListener('unmute', () => window.clearTimeout(muteTimer));
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStream(null);
        setError(err instanceof Error ? err.message : String(err));
        retryLater();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(muteTimer);
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, enabled, attempt]);

  return { stream, error };
}

/**
 * Ambil satu frame penuh dari <video> sebagai JPEG.
 * `mirror` = true membalik kiri-kanan, dipakai bila tampilan di layar tamu dicerminkan, supaya foto
 * selalu sama persis dengan yang dilihat tamu di monitor.
 */
export function captureFrame(video: HTMLVideoElement, quality = 0.92, mirror = false): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  // video yang belum siap/mati melaporkan 0x0 atau 2x2: jangan pernah simpan foto sebesar itu
  if (w < 160 || h < 90) return Promise.reject(new Error(`kamera belum siap (${w}x${h})`));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('gagal membuat JPEG'))), 'image/jpeg', quality),
  );
}
