import crypto from 'node:crypto';
import { classifyStatus, DriveError } from './errors';
import type { UploadJob, Uploader } from './worker';

export interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
}

export interface GoogleEndpoints {
  api: string;
  upload: string;
  token: string;
}

/** Hanya dioverride oleh test (server Google tiruan lokal). Produksi memakai alamat Google asli. */
export function endpointsFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleEndpoints {
  return {
    api: env.GOOGLE_API_BASE ?? 'https://www.googleapis.com/drive/v3',
    upload: env.GOOGLE_UPLOAD_BASE ?? 'https://www.googleapis.com/upload/drive/v3',
    token: env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
  };
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SESSION_KEY_PROP = 'photoboothKey';

interface Options {
  fetch?: typeof fetch;
  endpoints?: GoogleEndpoints;
  now?: () => number;
  /** Batas waktu satu permintaan biasa / upload (ms). */
  timeoutMs?: number;
  uploadTimeoutMs?: number;
}

interface GoogleErrorBody {
  error?: string | { message?: string; errors?: { reason?: string }[] };
  error_description?: string;
}

/** Klien Google Drive minimal (OAuth refresh token + scope drive.file), tanpa pustaka tambahan. */
export class GoogleDrive implements Uploader {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly ep: GoogleEndpoints;
  private readonly now: () => number;

  constructor(
    private readonly creds: Credentials,
    private readonly opts: Options = {},
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.ep = opts.endpoints ?? endpointsFromEnv();
    this.now = opts.now ?? Date.now;
  }

  // ---------- HTTP ----------

  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriveError('network', msg);
    }
  }

  private async errorFrom(res: Response, what: string): Promise<DriveError> {
    let body: GoogleErrorBody = {};
    try {
      body = (await res.json()) as GoogleErrorBody;
    } catch {
      /* bukan JSON */
    }
    const e = body.error;
    const reason = typeof e === 'object' ? e?.errors?.[0]?.reason : undefined;
    const text = typeof e === 'object' ? e?.message : (body.error_description ?? e);
    const kind = classifyStatus(res.status, reason);
    return new DriveError(kind, `${what}: ${res.status}${text ? ` ${text}` : ''}`, res.status);
  }

  // ---------- OAuth ----------

  /** Access token yang masih berlaku; diperbarui lewat refresh token bila perlu. */
  async getAccessToken(force = false): Promise<string> {
    const t = this.now();
    if (!force && this.accessToken && this.accessToken.expiresAt - 60_000 > t) return this.accessToken.value;

    const res = await this.send(
      this.ep.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          refresh_token: this.creds.refreshToken,
          grant_type: 'refresh_token',
        }),
      },
      this.opts.timeoutMs ?? 20_000,
    );
    if (!res.ok) {
      const err = await this.errorFrom(res, 'Google sign-in');
      // 400 invalid_grant / invalid_client = token dicabut atau kredensial salah
      if (res.status === 400 || res.status === 401) {
        throw new DriveError(
          'auth',
          'Google sign-in expired or was revoked. Run "npm run drive:setup" again.',
          res.status,
        );
      }
      throw err;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new DriveError('permanent', 'Google sign-in: no access_token in response');
    this.accessToken = { value: json.access_token, expiresAt: t + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  /** Permintaan terotentikasi; satu kali coba ulang dengan token baru bila 401. */
  private async call(url: string, init: RequestInit, what: string, timeoutMs?: number): Promise<Response> {
    const timeout = timeoutMs ?? this.opts.timeoutMs ?? 20_000;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken(attempt > 0);
      const res = await this.send(
        url,
        { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } },
        timeout,
      );
      if (res.status === 401 && attempt === 0) {
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      if (!res.ok) throw await this.errorFrom(res, what);
      return res;
    }
  }

  // ---------- operasi Drive ----------

  /** Cari file yang sudah pernah diupload untuk sesi ini (mencegah file ganda saat upload diulang). */
  async findBySessionKey(sessionKey: string): Promise<string | null> {
    const q = `appProperties has { key='${SESSION_KEY_PROP}' and value='${sessionKey.replace(/'/g, '')}' } and '${this.creds.folderId}' in parents and trashed=false`;
    const url = `${this.ep.api}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`;
    const res = await this.call(url, { method: 'GET' }, 'Drive search');
    const json = (await res.json()) as { files?: { id: string }[] };
    return json.files?.[0]?.id ?? null;
  }

  async upload(job: UploadJob): Promise<{ fileId: string }> {
    const existing = await this.findBySessionKey(job.sessionKey);
    if (existing) return { fileId: existing };

    const boundary = `pb${crypto.randomBytes(12).toString('hex')}`;
    const metadata = {
      name: job.name,
      parents: [this.creds.folderId],
      mimeType: 'image/png',
      appProperties: { [SESSION_KEY_PROP]: job.sessionKey },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: image/png\r\n\r\n`,
      ),
      job.data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.call(
      `${this.ep.upload}/files?uploadType=multipart&fields=id`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
      'Drive upload',
      this.opts.uploadTimeoutMs ?? 90_000,
    );
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveError('transient', 'Drive upload: response had no file id');
    return { fileId: json.id };
  }

  /** Info folder tujuan. Gagal (404) bila folder tidak ada atau tidak bisa diakses oleh scope drive.file. */
  async folderInfo(): Promise<{ id: string; name: string }> {
    const url = `${this.ep.api}/files/${encodeURIComponent(this.creds.folderId)}?fields=id,name,mimeType,trashed`;
    let res: Response;
    try {
      res = await this.call(url, { method: 'GET' }, 'Drive folder');
    } catch (err) {
      if (err instanceof DriveError && err.status === 404) {
        throw new DriveError(
          'permanent',
          'Folder not found or not accessible. With the drive.file permission the app can only use folders it created: run npm run drive:setup -- --create-folder "Photobooth"',
          404,
        );
      }
      throw err;
    }
    const json = (await res.json()) as { id: string; name: string; mimeType?: string; trashed?: boolean };
    if (json.mimeType && json.mimeType !== 'application/vnd.google-apps.folder') {
      throw new DriveError('permanent', 'DRIVE_FOLDER_ID points to a file, not a folder');
    }
    if (json.trashed) throw new DriveError('permanent', 'The Drive folder is in the trash');
    return { id: json.id, name: json.name };
  }

  /** Akun yang terhubung (best effort; bisa gagal dengan scope sempit). */
  async account(): Promise<string | null> {
    try {
      const res = await this.call(`${this.ep.api}/about?fields=user(emailAddress,displayName)`, { method: 'GET' }, 'Drive about');
      const json = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
      return json.user?.emailAddress ?? json.user?.displayName ?? null;
    } catch {
      return null;
    }
  }

  async createFolder(name: string): Promise<string> {
    const res = await this.call(
      `${this.ep.api}/files?fields=id`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
      },
      'Drive create folder',
    );
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new DriveError('permanent', 'Drive create folder: no id in response');
    return json.id;
  }
}

/** Ambil ID folder dari ID polos atau URL Drive (…/folders/<id>?…). */
export function parseFolderId(input: string): string | null {
  const s = input.trim();
  const fromUrl = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}
