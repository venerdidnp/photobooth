/**
 * Cek koneksi internet secara berkala (HTTP 204 ringan, tanpa data pengguna).
 * Dipakai untuk indikator offline di panel operator dan layar "PHOTO SAVED LOCALLY" di /booth.
 */
export interface ConnectivityMonitor {
  isOnline(): boolean;
  /** Tandai offline/online dari luar (mis. upload gagal karena jaringan). */
  report(online: boolean): void;
  stop(): void;
}

export function startConnectivityMonitor(
  onChange: (online: boolean) => void,
  opts: { url?: string; intervalMs?: number; timeoutMs?: number } = {},
): ConnectivityMonitor {
  const url = opts.url ?? process.env.CONNECTIVITY_URL ?? 'https://www.gstatic.com/generate_204';
  const intervalMs = opts.intervalMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  let online = true;
  let stopped = false;

  const set = (next: boolean) => {
    if (next !== online) {
      online = next;
      onChange(online);
    }
  };

  const check = async () => {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
      set(res.status >= 200 && res.status < 400);
    } catch {
      set(false);
    }
  };

  void check();
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref();

  return {
    isOnline: () => online,
    report: (v) => {
      if (!stopped) set(v);
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
