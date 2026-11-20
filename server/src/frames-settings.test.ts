import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import { scanFrames, validateFrameJson } from './frames';
import { sanitizeSettings, SettingsStore } from './settings';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const goodFrame = {
  name: 'Contoh',
  width: 800,
  height: 2000,
  slots: [
    { x: 80, y: 100, width: 640, height: 480 },
    { x: 80, y: 640, width: 640, height: 480 },
    { x: 80, y: 1180, width: 640, height: 480 },
  ],
};

describe('frame', () => {
  it('menerima JSON yang valid', () => {
    expect(validateFrameJson(goodFrame)).toBeNull();
  });

  it.each([
    ['bukan objek', null],
    ['tanpa ukuran', { ...goodFrame, width: 0 }],
    ['tanpa slot', { ...goodFrame, slots: [] }],
    ['slot keluar canvas', { ...goodFrame, slots: [{ x: 700, y: 0, width: 200, height: 100 }] }],
    ['slot pecahan', { ...goodFrame, slots: [{ x: 1.5, y: 0, width: 10, height: 10 }] }],
    ['image berisi folder', { ...goodFrame, image: '../x.png' }],
  ])('menolak: %s', (_label, raw) => {
    expect(validateFrameJson(raw)).not.toBeNull();
  });

  it('scanFrames menemukan PNG+JSON dan melewati yang rusak/tanpa gambar', () => {
    fs.writeFileSync(path.join(dir, 'sunset.json'), JSON.stringify(goodFrame));
    fs.writeFileSync(path.join(dir, 'sunset.png'), 'png');
    fs.writeFileSync(path.join(dir, 'tanpa-gambar.json'), JSON.stringify(goodFrame));
    fs.writeFileSync(path.join(dir, 'rusak.json'), '{ rusak');
    fs.writeFileSync(path.join(dir, 'catatan.txt'), 'abaikan');

    const { frames, skipped } = scanFrames(dir);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 'sunset', name: 'Contoh', imageUrl: '/frames/sunset.png' });
    expect(skipped.map((s) => s.file).sort()).toEqual(['rusak.json', 'tanpa-gambar.json']);
  });

  it('frame baru cukup ditaruh sebagai file, tanpa mengubah kode', () => {
    expect(scanFrames(dir).frames).toHaveLength(0);
    fs.writeFileSync(path.join(dir, 'arcade.json'), JSON.stringify({ ...goodFrame, image: 'arcade-v2.png' }));
    fs.writeFileSync(path.join(dir, 'arcade-v2.png'), 'png');
    expect(scanFrames(dir).frames.map((f) => [f.id, f.imageUrl])).toEqual([['arcade', '/frames/arcade-v2.png']]);
  });

  it('folder tidak ada -> daftar kosong, tidak error', () => {
    expect(scanFrames(path.join(dir, 'nope')).frames).toEqual([]);
  });
});

describe('settings', () => {
  it('membatasi angka ke rentang yang diizinkan dan membuang field asing', () => {
    const s = sanitizeSettings({ countdownSec: 999, pauseSec: -4, sound: 'ya', hack: 1 });
    expect(s.countdownSec).toBe(15);
    expect(s.pauseSec).toBe(1);
    expect(s.sound).toBe(DEFAULT_SETTINGS.sound);
    expect(s).not.toHaveProperty('hack');
  });

  it('tersimpan ke disk dan terbaca lagi setelah restart', () => {
    const file = path.join(dir, 'settings.json');
    const a = new SettingsStore(file);
    a.update({ countdownSec: 7, flash: false, frameId: 'sunset' });
    const b = new SettingsStore(file);
    expect(b.get()).toMatchObject({ countdownSec: 7, flash: false, frameId: 'sunset' });
  });

  it('file settings rusak -> pakai default', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, 'bukan json');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });
});
