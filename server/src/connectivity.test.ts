import { describe, expect, it } from 'vitest';
import { startConnectivityMonitor } from './connectivity';

describe('pemantau koneksi', () => {
  it('tidak melaporkan hasil cek yang telat setelah stop', async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as typeof fetch;
    const changes: boolean[] = [];
    const monitor = startConnectivityMonitor((v) => changes.push(v), {
      fetch: fetchImpl,
      intervalMs: 60_000,
      timeoutMs: 1,
    });

    monitor.stop();
    resolveFetch(new Response(null, { status: 204 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(changes).toEqual([]);
  });
});
