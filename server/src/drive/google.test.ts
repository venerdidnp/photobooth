import { describe, expect, it } from 'vitest';
import { classifyStatus, DriveError } from './errors';
import { GoogleDrive, parseFolderId, type GoogleEndpoints } from './google';

const ep: GoogleEndpoints = {
  api: 'https://api.test/drive/v3',
  upload: 'https://api.test/upload/drive/v3',
  token: 'https://api.test/token',
};
const creds = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rtok', folderId: 'FOLDER12345' };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit | null;
}

type Handler = (call: Call) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Server Google tiruan yang sehat: token, pencarian kosong, upload sukses. */
const healthy =
  (over: Partial<Record<'search' | 'upload', Handler>> = {}): Handler =>
  (call) => {
    if (call.url.startsWith(ep.token)) return json({ access_token: 'AT1', expires_in: 3600 });
    if (call.url.includes('/files?q=') || call.url.includes('/files?q')) return over.search?.(call) ?? json({ files: [] });
    if (call.url.startsWith(ep.upload)) return over.upload?.(call) ?? json({ id: 'new-file-id' });
    return json({}, 404);
  };

const make = (handler: Handler, now = () => 1_000_000) => {
  const f = fakeFetch(handler);
  return { ...f, drive: new GoogleDrive(creds, { fetch: f.fn, endpoints: ep, now }) };
};

const bodyText = (b: BodyInit | null | undefined) => (Buffer.isBuffer(b) ? b.toString('latin1') : String(b));

describe('upload ke Drive', () => {
  it('mengirim multipart: nama file, folder induk, kunci sesi, dan isi file, dengan bearer token', async () => {
    const { drive, calls } = make(healthy());
    const res = await drive.upload({ name: 'PHOTO #042.png', data: Buffer.from('PNGDATA'), sessionKey: '42-111' });
    expect(res).toEqual({ fileId: 'new-file-id' });

    const up = calls.find((c) => c.url.startsWith(ep.upload))!;
    expect(up.method).toBe('POST');
    expect(up.url).toContain('uploadType=multipart');
    expect(up.headers.Authorization).toBe('Bearer AT1');
    expect(up.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const text = bodyText(up.body);
    expect(text).toContain('"name":"PHOTO #042.png"');
    expect(text).toContain('"parents":["FOLDER12345"]');
    expect(text).toContain('"photoboothKey":"42-111"');
    expect(text).toContain('PNGDATA');
  });

  it('idempoten: kalau file sesi ini sudah ada di Drive, tidak mengupload lagi (tidak ada file ganda)', async () => {
    const { drive, calls } = make(healthy({ search: () => json({ files: [{ id: 'already-there' }] }) }));
    const res = await drive.upload({ name: 'PHOTO #042.png', data: Buffer.from('x'), sessionKey: '42-111' });
    expect(res).toEqual({ fileId: 'already-there' });
    expect(calls.some((c) => c.url.startsWith(ep.upload))).toBe(false);
  });

  it('pencarian memakai kunci sesi + folder tujuan', async () => {
    const { drive, calls } = make(healthy());
    await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: '7-99' });
    const search = new URL(calls.find((c) => c.url.includes('/files?q'))!.url).searchParams.get('q')!;
    expect(search).toContain("appProperties has { key='photoboothKey' and value='7-99' }");
    expect(search).toContain("'FOLDER12345' in parents");
    expect(search).toContain('trashed=false');
  });
});

describe('token', () => {
  it('access token dipakai ulang sampai hampir kedaluwarsa, lalu diperbarui lewat refresh token', async () => {
    let t = 1_000_000;
    const { drive, calls } = make(healthy(), () => t);
    await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: 'k1' });
    await drive.upload({ name: 'b', data: Buffer.from('x'), sessionKey: 'k2' });
    expect(calls.filter((c) => c.url.startsWith(ep.token))).toHaveLength(1);

    const refresh = calls.find((c) => c.url.startsWith(ep.token))!;
    const form = new URLSearchParams(String(refresh.body));
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rtok',
      client_id: 'cid',
      client_secret: 'sec',
    });

    t += 3600_000; // lewat masa berlaku
    await drive.upload({ name: 'c', data: Buffer.from('x'), sessionKey: 'k3' });
    expect(calls.filter((c) => c.url.startsWith(ep.token))).toHaveLength(2);
  });

  it('401 dari Drive: token diperbarui sekali lalu permintaan diulang', async () => {
    let first = true;
    const { drive, calls } = make((call) => {
      if (call.url.startsWith(ep.token)) return json({ access_token: first ? 'OLD' : 'NEW', expires_in: 3600 });
      if (call.url.includes('/files?q')) {
        if (first) {
          first = false;
          return json({ error: { message: 'Invalid Credentials' } }, 401);
        }
        return json({ files: [] });
      }
      return json({ id: 'f' });
    });
    await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: 'k' });
    const auths = calls.filter((c) => !c.url.startsWith(ep.token)).map((c) => c.headers.Authorization);
    expect(auths).toEqual(['Bearer OLD', 'Bearer NEW', 'Bearer NEW']);
  });

  it('refresh token dicabut (invalid_grant) -> error "auth" dengan petunjuk setup ulang', async () => {
    const { drive } = make(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
    const err = await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: 'k' }).catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.kind).toBe('auth');
    expect(err.message).toMatch(/drive:setup/);
  });
});

describe('klasifikasi error', () => {
  const fail = (status: number, body: unknown = { error: { message: 'x' } }) =>
    make((call) => (call.url.startsWith(ep.token) ? json({ access_token: 'AT', expires_in: 3600 }) : json(body, status)));

  it.each([
    [500, 'transient'],
    [503, 'transient'],
    [429, 'transient'],
    [400, 'permanent'],
    [413, 'permanent'],
  ] as const)('HTTP %i -> %s', async (status, kind) => {
    const { drive } = fail(status);
    const err = await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: 'k' }).catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.kind).toBe(kind);
  });

  it('403 karena batas laju = sementara; 403 izin/kuota = permanen', () => {
    expect(classifyStatus(403, 'userRateLimitExceeded')).toBe('transient');
    expect(classifyStatus(403, 'rateLimitExceeded')).toBe('transient');
    expect(classifyStatus(403, 'storageQuotaExceeded')).toBe('permanent');
    expect(classifyStatus(403)).toBe('permanent');
    expect(classifyStatus(401)).toBe('auth');
  });

  it('fetch gagal (internet mati/timeout) -> "network"', async () => {
    const { drive } = make(() => {
      throw new TypeError('fetch failed');
    });
    const err = await drive.upload({ name: 'a', data: Buffer.from('x'), sessionKey: 'k' }).catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.kind).toBe('network');
  });
});

describe('folder', () => {
  it('folder 404 (tidak ada / bukan buatan aplikasi) -> pesan yang menunjuk --create-folder', async () => {
    const { drive } = make((call) =>
      call.url.startsWith(ep.token) ? json({ access_token: 'AT', expires_in: 3600 }) : json({ error: { message: 'File not found' } }, 404),
    );
    const err = await drive.folderInfo().catch((e) => e);
    expect(err.kind).toBe('permanent');
    expect(err.message).toMatch(/--create-folder/);
  });

  it('folder valid mengembalikan namanya; file biasa atau tempat sampah ditolak', async () => {
    const respond = (meta: object) =>
      make((call) => (call.url.startsWith(ep.token) ? json({ access_token: 'AT', expires_in: 3600 }) : json(meta)));
    const folder = { id: 'FOLDER12345', name: 'Photobooth', mimeType: 'application/vnd.google-apps.folder' };
    expect(await respond(folder).drive.folderInfo()).toEqual({ id: 'FOLDER12345', name: 'Photobooth' });
    await expect(respond({ ...folder, mimeType: 'image/png' }).drive.folderInfo()).rejects.toThrow(/not a folder/);
    await expect(respond({ ...folder, trashed: true }).drive.folderInfo()).rejects.toThrow(/trash/);
  });

  it('createFolder mengirim tipe folder dan mengembalikan id', async () => {
    const { drive, calls } = make((call) =>
      call.url.startsWith(ep.token) ? json({ access_token: 'AT', expires_in: 3600 }) : json({ id: 'NEWFOLDER' }),
    );
    expect(await drive.createFolder('Photobooth Informatika 6')).toBe('NEWFOLDER');
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith(ep.api))!;
    expect(JSON.parse(String(post.body))).toEqual({
      name: 'Photobooth Informatika 6',
      mimeType: 'application/vnd.google-apps.folder',
    });
  });
});

describe('parseFolderId', () => {
  it.each([
    ['1AbCdEfGhIjKlMnOpQrStUv', '1AbCdEfGhIjKlMnOpQrStUv'],
    ['https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing', '1AbCdEfGhIjKlMnOpQrStUv'],
    ['https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUv', '1AbCdEfGhIjKlMnOpQrStUv'],
    ['https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv', '1AbCdEfGhIjKlMnOpQrStUv'],
    ['  1AbCdEfGhIjKlMnOpQrStUv  ', '1AbCdEfGhIjKlMnOpQrStUv'],
    ['bukan id folder!', null],
    ['', null],
  ])('%s', (input, expected) => {
    expect(parseFolderId(input)).toBe(expected);
  });
});
