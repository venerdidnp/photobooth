import fs from 'node:fs';
import path from 'node:path';
import type { DriveInfo } from '../../../shared/protocol';
import { writeFileAtomic } from '../session-store';
import { DriveError, type DriveErrorKind } from './errors';
import { GoogleDrive, parseFolderId, type Credentials, type GoogleEndpoints } from './google';
import type { UploadJob, Uploader } from './worker';

export function drivePaths(dataDir: string) {
  return {
    token: path.join(dataDir, 'google-token.json'),
    folder: path.join(dataDir, 'drive-folder.json'),
  };
}

export function readTokenFile(file: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { refresh_token?: unknown };
    return typeof raw.refresh_token === 'string' && raw.refresh_token ? raw.refresh_token : null;
  } catch {
    return null;
  }
}

export function writeTokenFile(file: string, refreshToken: string): void {
  writeFileAtomic(file, JSON.stringify({ refresh_token: refreshToken, created_at: new Date().toISOString() }, null, 2));
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows: abaikan */
  }
}

export function readFolderOverride(file: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { folderId?: unknown };
    return typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null;
  } catch {
    return null;
  }
}

export interface DriveServiceDeps {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  endpoints?: GoogleEndpoints;
  log?: (msg: string) => void;
  /** Status Drive berubah (untuk menyiarkan ke panel operator). */
  onChange?: () => void;
}

/**
 * Membungkus klien Drive: membaca konfigurasi (.env + file token + override folder),
 * melaporkan status untuk panel operator, dan menangani ganti folder / putus koneksi.
 */
export class DriveService implements Uploader {
  private drive: GoogleDrive | null = null;
  private missing: string | null = null;
  private lastError: { kind: DriveErrorKind; message: string } | null = null;
  private account: string | undefined;
  private folderName: string | undefined;
  private readonly files: ReturnType<typeof drivePaths>;

  constructor(private readonly d: DriveServiceDeps) {
    this.files = drivePaths(d.dataDir);
    this.reload();
  }

  /** Baca ulang konfigurasi dari .env dan file di data/. */
  reload(): void {
    const env = this.d.env ?? process.env;
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    const folderId = readFolderOverride(this.files.folder) ?? env.DRIVE_FOLDER_ID?.trim();
    const refreshToken = readTokenFile(this.files.token);

    this.lastError = null;
    this.account = undefined;
    this.folderName = undefined;

    if (!clientId || !clientSecret) {
      this.missing = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env';
    } else if (!refreshToken) {
      this.missing = 'Not signed in yet. Run "npm run drive:setup".';
    } else if (!folderId) {
      this.missing = 'No destination folder. Set DRIVE_FOLDER_ID in .env or run "npm run drive:setup -- --create-folder".';
    } else {
      this.missing = null;
      const creds: Credentials = { clientId, clientSecret, refreshToken, folderId };
      this.drive = new GoogleDrive(creds, { fetch: this.d.fetch, endpoints: this.d.endpoints });
      this.d.onChange?.();
      return;
    }
    this.drive = null;
    this.d.onChange?.();
  }

  isConfigured(): boolean {
    return this.drive !== null;
  }

  info(): DriveInfo {
    if (!this.drive) return { configured: false, status: 'off', error: this.missing ?? undefined };
    const bad = this.lastError && (this.lastError.kind === 'auth' || this.lastError.kind === 'permanent');
    return {
      configured: true,
      status: bad ? 'error' : 'ok',
      account: this.account,
      folderName: this.folderName,
      error: bad ? this.lastError!.message : undefined,
    };
  }

  /** Periksa token dan folder. Gagal jaringan tidak dianggap masalah Drive. */
  async verify(): Promise<void> {
    const drive = this.drive;
    if (!drive) return;
    try {
      const folder = await drive.folderInfo();
      this.folderName = folder.name;
      this.account = (await drive.account()) ?? this.account;
      this.lastError = null;
    } catch (err) {
      if (err instanceof DriveError && err.kind !== 'network') {
        this.lastError = { kind: err.kind, message: err.message };
        this.d.log?.(`Drive: ${err.message}`);
      }
    }
    this.d.onChange?.();
  }

  noteSuccess(): void {
    if (this.lastError) {
      this.lastError = null;
      this.d.onChange?.();
    }
  }

  noteProblem(message: string, kind: DriveErrorKind): void {
    this.lastError = { kind, message };
    this.d.onChange?.();
  }

  async upload(job: UploadJob): Promise<{ fileId: string }> {
    if (!this.drive) throw new DriveError('permanent', this.missing ?? 'Google Drive is not set up');
    return this.drive.upload(job);
  }

  /** Putuskan akun: hapus token. Menghubungkan lagi lewat `npm run drive:setup`. */
  disconnect(): void {
    try {
      fs.rmSync(this.files.token, { force: true });
    } catch {
      /* sudah tidak ada */
    }
    this.reload();
  }

  /** Ganti folder tujuan (ID atau URL folder Drive). Folder diperiksa dulu sebelum disimpan. */
  async setFolder(input: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const id = parseFolderId(input);
    if (!id) return { ok: false, error: 'That does not look like a Drive folder ID or link.' };

    const env = this.d.env ?? process.env;
    const refreshToken = readTokenFile(this.files.token);
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    if (!refreshToken || !clientId || !clientSecret) return { ok: false, error: this.missing ?? 'Google Drive is not set up' };

    const probe = new GoogleDrive(
      { clientId, clientSecret, refreshToken, folderId: id },
      { fetch: this.d.fetch, endpoints: this.d.endpoints },
    );
    try {
      const folder = await probe.folderInfo();
      writeFileAtomic(this.files.folder, JSON.stringify({ folderId: id }, null, 2));
      this.reload();
      this.folderName = folder.name;
      this.d.onChange?.();
      return { ok: true, name: folder.name };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
