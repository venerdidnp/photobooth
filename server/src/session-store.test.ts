import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSessionNo, stripFileName } from '../../shared/protocol';
import { SessionStore, toSummary, type SessionMeta } from './session-store';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const meta = (no: number, patch: Partial<SessionMeta> = {}): SessionMeta => ({
  no,
  createdAt: '2026-11-20T10:00:00.000Z',
  frameId: 'sunset',
  slotCount: 3,
  status: 'in_progress',
  slotRevs: [0, 0, 0],
  stripRev: 0,
  retakes: 0,
  ...patch,
});

describe('penomoran sesi', () => {
  it('berurutan mulai dari 001', () => {
    const s = new SessionStore(dir);
    expect(s.reserveNext()).toBe(1);
    expect(s.reserveNext()).toBe(2);
    expect(s.reserveNext()).toBe(3);
    expect(formatSessionNo(1)).toBe('001');
    expect(fs.existsSync(path.join(dir, 'sessions', '003'))).toBe(true);
  });

  it('peekNext tidak mengambil nomor', () => {
    const s = new SessionStore(dir);
    expect(s.peekNext()).toBe(1);
    expect(s.peekNext()).toBe(1);
    s.reserveNext();
    expect(s.peekNext()).toBe(2);
  });

  it('tetap berlanjut setelah server restart (instance baru, folder data sama)', () => {
    const a = new SessionStore(dir);
    a.reserveNext();
    a.reserveNext();
    const b = new SessionStore(dir);
    expect(b.reserveNext()).toBe(3);
  });

  it('berlanjut dari folder terbesar bila counter.json hilang atau rusak', () => {
    const a = new SessionStore(dir);
    for (let i = 0; i < 5; i++) a.reserveNext();
    fs.rmSync(path.join(dir, 'counter.json'));
    expect(new SessionStore(dir).peekNext()).toBe(6);

    fs.writeFileSync(path.join(dir, 'counter.json'), '{ rusak');
    expect(new SessionStore(dir).peekNext()).toBe(6);
  });

  it('tidak pernah memakai ulang nomor sesi yang dibatalkan/dihapus foldernya', () => {
    const s = new SessionStore(dir);
    s.reserveNext(); // 1
    s.reserveNext(); // 2
    fs.rmSync(s.dir(2), { recursive: true });
    expect(new SessionStore(dir).reserveNext()).toBe(3); // counter.json masih ingat 2
  });

  it('melewati nomor lebih dari 999 tanpa merusak urutan', () => {
    fs.mkdirSync(path.join(dir, 'sessions', '999'), { recursive: true });
    const s = new SessionStore(dir);
    expect(s.reserveNext()).toBe(1000);
    expect(formatSessionNo(1000)).toBe('1000');
  });

  it('nama file untuk Drive: "PHOTO #042.png"', () => {
    expect(stripFileName(42)).toBe('PHOTO #042.png');
  });
});

describe('penyimpanan sesi', () => {
  it('menulis foto per slot, strip, dan meta di data/sessions/<nomor>/', () => {
    const s = new SessionStore(dir);
    const no = s.reserveNext();
    s.writeMeta(meta(no));
    s.writeShot(no, 1, Buffer.from('jpg1'));
    s.writeShot(no, 2, Buffer.from('jpg2'));
    s.writeStrip(no, Buffer.from('png'));

    const files = fs.readdirSync(s.dir(no)).sort();
    expect(files).toEqual(['meta.json', 'slot-1.jpg', 'slot-2.jpg', 'strip.png']);
    expect(fs.readFileSync(s.shotPath(no, 2), 'utf8')).toBe('jpg2');
    expect(s.hasStrip(no)).toBe(true);
  });

  it('tidak meninggalkan file .tmp setelah menulis', () => {
    const s = new SessionStore(dir);
    const no = s.reserveNext();
    s.writeMeta(meta(no));
    s.writeShot(no, 1, Buffer.from('x'));
    expect(fs.readdirSync(s.dir(no)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('retake menimpa foto slot yang sama', () => {
    const s = new SessionStore(dir);
    const no = s.reserveNext();
    s.writeShot(no, 2, Buffer.from('lama'));
    s.writeShot(no, 2, Buffer.from('baru'));
    expect(fs.readFileSync(s.shotPath(no, 2), 'utf8')).toBe('baru');
  });

  it('updateMeta + list terbaru dulu + ringkasan default upload "queued"', () => {
    const s = new SessionStore(dir);
    for (let i = 0; i < 3; i++) s.writeMeta(meta(s.reserveNext()));
    s.updateMeta(2, (m) => ({ ...m, status: 'finalized' }));
    const list = s.list();
    expect(list.map((m) => m.no)).toEqual([3, 2, 1]);
    expect(toSummary(list[1]!)).toMatchObject({ label: '002', status: 'finalized', uploadStatus: 'queued' });
    expect(s.updateMeta(99, (m) => m)).toBeNull();
  });

  it('markAbandoned menandai sesi yang masih berjalan saat server mati', () => {
    const s = new SessionStore(dir);
    s.writeMeta(meta(s.reserveNext(), { status: 'in_progress' }));
    s.writeMeta(meta(s.reserveNext(), { status: 'finalized' }));
    expect(new SessionStore(dir).markAbandoned()).toBe(1);
    expect(s.list().map((m) => m.status)).toEqual(['finalized', 'abandoned']);
  });
});
