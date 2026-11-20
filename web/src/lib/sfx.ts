/**
 * Efek suara sederhana (bip WebAudio, tanpa file audio supaya jalan offline).
 * Browser menahan audio sampai ada interaksi pengguna di halaman itu. Jalankan Chrome dengan
 * --autoplay-policy=no-user-gesture-required (lihat README) atau klik sekali di jendela /booth.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Pasang sekali: interaksi pertama membuka kunci audio. */
export function unlockAudioOnInteraction(): void {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function beep(freq: number, ms: number, type: OscillatorType = 'square', gain = 0.08): void {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(c.destination);
  const t = c.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

export const sfx = {
  tick: () => beep(660, 120),
  lastTick: () => beep(880, 220),
  shutter: () => {
    beep(1320, 80, 'square', 0.1);
    window.setTimeout(() => beep(660, 140, 'square', 0.1), 70);
  },
  done: () => {
    beep(784, 120);
    window.setTimeout(() => beep(988, 120), 120);
    window.setTimeout(() => beep(1319, 240), 240);
  },
};
