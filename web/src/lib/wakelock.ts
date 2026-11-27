import { useEffect } from 'react';

/**
 * Tahan layar supaya tidak redup/tidur selama halaman terbuka (layar tidur membuat webcam berhenti).
 * Dilepas otomatis oleh browser saat tab disembunyikan, jadi diminta lagi ketika tab terlihat.
 * Hanya jalan di HTTPS atau localhost; di tempat lain diam-diam diabaikan.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    const request = async () => {
      try {
        const next = await navigator.wakeLock?.request('screen');
        if (!next) return;
        if (stopped) void next.release();
        else lock = next;
      } catch {
        /* ditolak (mis. baterai hemat) atau tidak didukung: abaikan */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}
