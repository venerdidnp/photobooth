import { useEffect, useState } from 'react';

const STORAGE_KEY = 'photobooth.cameraId';

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

/** Minta izin kamera dulu supaya label perangkat terbaca, lalu daftar semua webcam. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch {
    /* tetap coba enumerateDevices; label bisa kosong */
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

async function openStream(deviceId: string | null): Promise<MediaStream> {
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
    const retryLater = () => {
      retryTimer = window.setTimeout(() => !cancelled && setAttempt((n) => n + 1), RETRY_MS);
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
        s.getVideoTracks().forEach((t) =>
          t.addEventListener('ended', () => {
            if (cancelled) return;
            setStream(null);
            setError('camera disconnected');
            retryLater();
          }),
        );
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
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, enabled, attempt]);

  return { stream, error };
}

/** Ambil satu frame penuh dari <video> sebagai JPEG (tidak dibalik, walau preview dicerminkan). */
export function captureFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  // video yang belum siap/mati melaporkan 0x0 atau 2x2: jangan pernah simpan foto sebesar itu
  if (w < 160 || h < 90) return Promise.reject(new Error(`kamera belum siap (${w}x${h})`));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('gagal membuat JPEG'))), 'image/jpeg', quality),
  );
}
