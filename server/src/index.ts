import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Controller } from './controller';
import { startConnectivityMonitor } from './connectivity';
import { SessionStore, toSummary } from './session-store';
import { SettingsStore } from './settings';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// .env sederhana (tanpa dependensi): KEY=VALUE per baris, tidak menimpa variabel yang sudah ada.
function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
}
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

let online = true;
const controller: Controller = new Controller({
  store,
  settings,
  framesDir,
  isOnline: () => online,
  log,
});
const connectivity = startConnectivityMonitor((next) => {
  online = next;
  log(next ? 'internet tersambung' : 'internet terputus');
  controller.onOnlineChange();
});

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
app.get('/api/queue', async () => ({ items: [], summary: controller.publicState().uploads }));
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

const shutdown = async () => {
  clearInterval(heartbeat);
  connectivity.stop();
  controller.dispose();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: PORT, host: HOST });
const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
log(`Operator (laptop):      ${base}/admin`);
log(`Tampilan tamu (monitor): ${base}/booth`);
log(`Data: ${dataDir} | Frame: ${framesDir}${hasDist ? '' : ' | (frontend belum dibuild)'}`);
