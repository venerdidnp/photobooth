import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ClientRole, PublicState, ServerMsg } from '../../../shared/protocol';

/**
 * Koneksi WebSocket ke server dengan sambung-ulang otomatis.
 * `state` selalu snapshot terbaru dari server; pesan perintah (capture/assemble) lewat `onMessage`.
 */
export function useServer(role: ClientRole, onMessage?: (msg: ServerMsg) => void) {
  const [state, setState] = useState<PublicState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'hello', role } satisfies ClientMsg));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.type === 'state') setState(msg.state);
        handlerRef.current?.(msg);
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) retry = window.setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [role]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, connected, send };
}

export function sessionFileUrl(no: number, file: string, rev: number): string {
  return `/files/sessions/${String(no).padStart(3, '0')}/${file}?v=${rev}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}
