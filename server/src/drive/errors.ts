/**
 * Jenis kegagalan upload menentukan perlakuan antrean:
 *  - network:   internet mati/timeout. Dicoba lagi terus dengan backoff, tidak pernah dianggap gagal.
 *  - transient: 429/5xx dari Google. Backoff, dianggap gagal setelah MAX_TRANSIENT_ATTEMPTS.
 *  - auth:      token kedaluwarsa/dicabut. Langsung gagal; operator perlu menjalankan setup ulang.
 *  - permanent: 4xx lain (folder tidak ada, kuota, dll). Langsung gagal.
 */
export type DriveErrorKind = 'network' | 'transient' | 'auth' | 'permanent';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

export function classifyStatus(status: number, reason?: string): DriveErrorKind {
  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (status === 403 && reason && RATE_LIMIT_REASONS.has(reason)) return 'transient';
  return 'permanent';
}

export interface BackoffPolicy {
  baseMs: number;
  capMs: number;
  /** Fraksi acak +/- (0.2 = +/-20%). */
  jitter?: number;
  random?: () => number;
}

/** Jeda sebelum percobaan ke-`attempt` (mulai dari 1): base * 2^(attempt-1), dibatasi cap, plus jitter. */
export function backoffMs(attempt: number, policy: BackoffPolicy): number {
  const exp = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = policy.jitter ?? 0.2;
  const r = (policy.random ?? Math.random)();
  return Math.max(0, Math.round(exp * (1 + (r * 2 - 1) * jitter)));
}

export const NETWORK_BACKOFF: BackoffPolicy = { baseMs: 2_000, capMs: 30_000 };
export const TRANSIENT_BACKOFF: BackoffPolicy = { baseMs: 5_000, capMs: 300_000 };
export const MAX_TRANSIENT_ATTEMPTS = 8;
