import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { stripFileName } from '../../shared/protocol';
import { Controller } from './controller';
import { startConnectivityMonitor } from './connectivity';
import { UploadQueue, type QueueRecord } from './drive/queue';
import { DriveService } from './drive/service';
import { UploadWorker } from './drive/worker';
import { loadEnv } from './env';
import { SessionStore, toSummary } from './session-store';
import { SettingsStore } from './settings';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv(path.join(root, '.env'));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
const framesDir = path.resolve(root, process.env.FRAMES_DIR ?? 'frames');
const distDir = path.join(root, 'dist');

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 40 * 1024 * 1024 });
const log = (msg: string) => app.log.info(msg);

const store = new SessionStore(dataDir);
const settings = new SettingsStore(path.join(dataDir, 'settings.json'));
const abandoned = store.markAbandoned();
if (abandoned > 0) log(`${abandoned} sesi yang belum selesai saat server mati ditandai 'abandoned'`);

// ---------- upload Google Drive (local-first) ----------

let controller!: Controller;
let worker!: UploadWorker;
const changed = () => controller?.onExternalChange();

const drive = new DriveService({ dataDir, log, onChange: changed });
const queue = new UploadQueue(path.join(dataDir, 'upload-queue.json'));
queue.onChange = changed;

let online = true;

/** Kunci unik sesi: mencegah file ganda di Drive kalau upload diulang, dan nomor yang sama di acara lain. */
const sessionKey = (no: number): string => {
  const meta = store.readMeta(no);
  return `${no}-${meta ? Date.parse(meta.createdAt) : 0}`;
};

/** Catat status upload di meta.json sesi (dipakai titik status di Gallery). */
const recordUploadStatus = (rec: QueueRecord): void => {
  store.updateMeta(rec.sessionNo, (m) => ({
    ...m,
    upload: {
      status: rec.status,
      driveFileId: rec.driveFileId,
      uploadedAt: rec.status === 'done' ? new Date(rec.finishedAt ?? Date.now()).toISOString() : m.upload?.uploadedAt,
      error: rec.error,
    },
  }));
};

const enqueueSession = (no: number): void => {
  let size: number;
  try {
    size = fs.statSync(store.stripPath(no)).size;
  } catch {
    log(`strip sesi #${no} tidak ada di disk, tidak dimasukkan ke antrean`);
    return;
  }
  recordUploadStatus(queue.enqueue(no, stripFileName(no), size));
  worker.kick();
};

controller = new Controller({
  store,
  settings,
  framesDir,
  isOnline: () => online,
  log,
  onFinalized: enqueueSession,
  drive: () => drive.info(),
  queueSummary: () => queue.summary(),
  onQueueRetry: (id) => {
    drive.reload();
    queue.retry(id);
    worker.kick();
    void drive.verify();
  },
});

const connectivity = startConnectivityMonitor((next) => {
  online = next;
  log(next ? 'internet tersambung' : 'internet terputus');
  if (next) {
    queue.expedite();
    worker.kick();
    void drive.verify();
  }
  controller.onOnlineChange();
});

worker = new UploadWorker({
  queue,
  uploader: drive,
  isConfigured: () => drive.isConfigured(),
  readFile: (rec) => fs.readFileSync(store.stripPath(rec.sessionNo)),
  sessionKey: (rec) => sessionKey(rec.sessionNo),
  onStatus: recordUploadStatus,
  onNetwork: (ok) => connectivity.report(ok),
  onAuthProblem: (msg) => drive.noteProblem(msg, 'auth'),
  onSuccess: () => drive.noteSuccess(),
  log,
});

// Sesi yang sudah selesai tetapi belum pernah masuk antrean (mis. dibuat sebelum Drive diaktifkan).
for (const meta of store.list()) {
  if (meta.status === 'finalized' && meta.upload?.status !== 'done' && !queue.hasSession(meta.no)) {
    enqueueSession(meta.no);
    log(`sesi #${meta.no} dimasukkan ke antrean upload`);
  }
}

// ---------- HTTP ----------

app.addContentTypeParser(['image/jpeg', 'image/png'], { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/state', async () => controller.publicState());
app.get('/api/frames', async () => controller.getFrames());
app.get('/api/settings', async () => settings.get());
app.put('/api/settings', async (req) => controller.updateSettings(req.body));
app.get('/api/sessions', async () => store.list().slice(0, 200).map(toSummary));
app.get('/api/queue', async () => ({ items: queue.list(100), summary: queue.summary() }));
app.post<{ Body: { folder?: string } }>('/api/drive/folder', async (req, reply) => {
  const result = await drive.setFolder(String(req.body?.folder ?? ''));
  if (!result.ok) return reply.code(400).send(result);
  worker.kick();
  return result;
});
app.post('/api/drive/disconnect', async () => {
  drive.disconnect();
  return { ok: true };
});
// path relatif terhadap folder proyek (lebih mudah dibaca operator)
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/') || '.';
app.get('/api/info', async () => ({
  dataDir: rel(dataDir),
  framesDir: rel(framesDir),
  frames: controller.getFrames().length,
}));

const intParam = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

app.post<{ Params: { no: string; slot: string } }>('/api/sessions/:no/shots/:slot', async (req, reply) => {
  const no = intParam(req.params.no);
  const slot = intParam(req.params.slot);
  if (Number.isNaN(no) || Number.isNaN(slot) || !Buffer.isBuffer(req.body) || req.body.length < 100) {
    return reply.code(400).send({ ok: false });
  }
  const result = controller.acceptShot(no, slot, req.body);
  return reply.code(result === 'ok' ? 200 : 409).send({ ok: result === 'ok' });
});

app.post<{ Params: { no: string } }>('/api/sessions/:no/strip', async (req, reply) => {
  const no = intParam(req.params.no);
  if (Number.isNaN(no) || !Buffer.isBuffer(req.body) || req.body.length < 100) {
    return reply.code(400).send({ ok: false });
  }
  const result = controller.acceptStrip(no, req.body);
  return reply.code(result === 'ok' ? 200 : 409).send({ ok: result === 'ok' });
});

// ---------- file statis ----------

const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
if (hasDist) {
  await app.register(fastifyStatic, { root: distDir, prefix: '/', index: ['index.html'] });
}
await app.register(fastifyStatic, {
  root: store.sessionsDir,
  prefix: '/files/sessions/',
  decorateReply: false,
  cacheControl: false,
  setHeaders: (res) => void res.header('Cache-Control', 'no-cache'),
});
fs.mkdirSync(framesDir, { recursive: true });
await app.register(fastifyStatic, {
  root: framesDir,
  prefix: '/frames/',
  decorateReply: false,
  cacheControl: false,
  setHeaders: (res) => void res.header('Cache-Control', 'no-cache'),
});

app.get('/', async (_req, reply) => reply.redirect('/admin'));

// /admin dan /booth adalah rute sisi-klien: sajikan index.html
app.setNotFoundHandler((req, reply) => {
  const isApp = req.method === 'GET' && /^\/(admin|booth)(\/|$)/.test(req.url);
  if (isApp && hasDist) return reply.sendFile('index.html');
  if (isApp) {
    return reply
      .code(503)
      .type('text/plain')
      .send('Frontend belum dibuild. Jalankan "npm start" (atau "npm run build"), atau "npm run dev" saat pengembangan.');
  }
  return reply.code(404).send({ error: 'not found' });
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true });
app.server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => controller.attach(ws));
});

// ping berkala supaya koneksi mati (mis. tab ditutup paksa) cepat terdeteksi
const alive = new WeakMap<object, boolean>();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 15_000);
wss.on('connection', (ws) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
});

// ---------- jalan ----------

const driveCheck = setInterval(() => void drive.verify(), 10 * 60_000);
driveCheck.unref();

const shutdown = async () => {
  clearInterval(heartbeat);
  clearInterval(driveCheck);
  worker.stop();
  connectivity.stop();
  controller.dispose();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: PORT, host: HOST });
worker.start();
void drive.verify();
log(
  drive.isConfigured()
    ? 'Google Drive: terkonfigurasi, upload berjalan di latar belakang'
    : `Google Drive: belum aktif (${drive.info().error ?? '-'}). Strip tetap tersimpan lokal.`,
);
const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
log(`Operator (laptop):      ${base}/admin`);
log(`Tampilan tamu (monitor): ${base}/booth`);
log(`Data: ${dataDir} | Frame: ${framesDir}${hasDist ? '' : ' | (frontend belum dibuild)'}`);
