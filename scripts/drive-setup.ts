/**
 * Setup Google Drive satu kali: login Google lewat browser, simpan refresh token di data/google-token.json,
 * lalu periksa (atau buat) folder tujuan.
 *
 *   npm run drive:setup                                   login + periksa DRIVE_FOLDER_ID dari .env
 *   npm run drive:setup -- --create-folder "Nama Folder"  buat folder baru milik aplikasi (disarankan)
 *   npm run drive:setup -- --reauth                       paksa login ulang
 *
 * Scope hanya drive.file: aplikasi hanya bisa menyentuh file/folder yang ia buat sendiri.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DriveError } from '../server/src/drive/errors';
import { DRIVE_SCOPE, endpointsFromEnv, GoogleDrive } from '../server/src/drive/google';
import { drivePaths, readFolderOverride, readTokenFile, writeTokenFile } from '../server/src/drive/service';
import { loadEnv } from '../server/src/env';
import { writeFileAtomic } from '../server/src/session-store';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
fs.mkdirSync(dataDir, { recursive: true });
const files = drivePaths(dataDir);

const args = process.argv.slice(2);
const reauth = args.includes('--reauth');
const createIdx = args.indexOf('--create-folder');
const createName = createIdx >= 0 ? (args[createIdx + 1] ?? 'Photobooth') : null;

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error(
    'GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum diisi di .env.\n' +
      'Ikuti langkah "Membuat kredensial Google" di README, lalu jalankan lagi.',
  );
  process.exit(1);
}

const ep = endpointsFromEnv();
const b64url = (b: Buffer) => b.toString('base64url');

/** Login lewat browser dengan redirect loopback (client "Desktop app") + PKCE. */
async function login(): Promise<string> {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

  console.log('\nBuka alamat ini di browser (login dengan akun Google panitia yang memiliki folder Drive):\n');
  console.log(authUrl + '\n');
  console.log('Menunggu persetujuan... (maksimal 5 menit)');

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Waktu habis menunggu login')), 5 * 60_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      const error = url.searchParams.get('error');
      const got = url.searchParams.get('code');
      if (url.searchParams.get('state') !== state && !error) {
        res.writeHead(400).end('State tidak cocok.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error ? `Login ditolak: ${error}` : 'Berhasil. Kembali ke terminal; jendela ini boleh ditutup.');
      clearTimeout(timer);
      if (error) reject(new Error(`Login ditolak: ${error}`));
      else if (got) resolve(got);
    });
  }).finally(() => server.close());

  const res = await fetch(ep.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.refresh_token) {
    throw new Error(
      `Gagal menukar kode login: ${json.error_description ?? json.error ?? res.status}` +
        (res.ok ? ' (tidak ada refresh token; coba lagi dengan --reauth)' : ''),
    );
  }
  return json.refresh_token;
}

async function main() {
  let refreshToken = readTokenFile(files.token);
  if (!refreshToken || reauth) {
    refreshToken = await login();
    writeTokenFile(files.token, refreshToken);
    console.log(`\nToken tersimpan di ${path.relative(root, files.token)} (jangan di-commit, sudah ada di .gitignore).`);
  } else {
    console.log(`Memakai token yang sudah ada (${path.relative(root, files.token)}). Gunakan --reauth untuk login ulang.`);
  }

  const envFolder = readFolderOverride(files.folder) ?? process.env.DRIVE_FOLDER_ID?.trim() ?? '';
  const makeDrive = (folderId: string) =>
    new GoogleDrive({ clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken!, folderId });

  const account = await makeDrive(envFolder || 'unused').account();
  console.log(`Akun Google: ${account ?? '(tidak diketahui)'}`);

  if (createName) {
    const id = await makeDrive('unused').createFolder(createName);
    writeFileAtomic(files.folder, JSON.stringify({ folderId: id }, null, 2));
    console.log(`\nFolder "${createName}" dibuat di Google Drive.`);
    console.log(`ID folder: ${id}`);
    console.log(`Tersimpan di ${path.relative(root, files.folder)}; Anda juga boleh menyalinnya ke .env sebagai DRIVE_FOLDER_ID.`);
    console.log('\nLangkah berikutnya: buka folder itu di drive.google.com, klik Bagikan, dan beri akses "Siapa saja yang memiliki link: Pelihat"');
    console.log('supaya tamu bisa membuka foto mereka.');
    return;
  }

  if (!envFolder) {
    console.log('\nBelum ada folder tujuan. Pilih salah satu:');
    console.log('  - jalankan: npm run drive:setup -- --create-folder "Photobooth Informatika 6"  (disarankan)');
    console.log('  - atau isi DRIVE_FOLDER_ID di .env lalu jalankan setup ini lagi.');
    return;
  }

  try {
    const folder = await makeDrive(envFolder).folderInfo();
    console.log(`\nFolder tujuan OK: "${folder.name}" (${folder.id}). Setup selesai.`);
  } catch (err) {
    console.error(`\nFolder tujuan tidak bisa dipakai: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nSetup gagal: ${err instanceof DriveError ? `${err.message}` : err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
