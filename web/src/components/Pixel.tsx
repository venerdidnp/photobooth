import type { CSSProperties } from 'react';

type Rect = [x: number, y: number, w: number, h: number];

const ink = { fill: 'var(--ink-main)' } satisfies CSSProperties;

/** Logo kamera piksel (Figma: "Camera icon" / "Logo"). */
export function PixelLogo({ width = 56 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 44) / 56} viewBox="0 0 56 44" aria-hidden>
      <rect x="0" y="10" width="56" height="34" style={ink} />
      <rect x="14" y="2" width="20" height="8" style={ink} />
      <rect x="20" y="18" width="16" height="16" style={{ fill: 'var(--brand-pink-strong)' }} />
      <rect x="44" y="14" width="8" height="6" style={{ fill: 'var(--brand-yellow)' }} />
    </svg>
  );
}

const ICONS: Record<'control' | 'queue' | 'gallery' | 'settings', Rect[]> = {
  control: [
    [4, 2, 6, 4], [4, 6, 12, 4], [4, 10, 18, 4], [4, 14, 24, 4], [4, 18, 18, 4], [4, 22, 12, 4], [4, 26, 6, 4],
  ],
  queue: [[2, 3, 28, 6], [6, 13, 20, 6], [2, 23, 28, 6]],
  gallery: [[2, 2, 12, 12], [18, 2, 12, 12], [2, 18, 12, 12], [18, 18, 12, 12]],
  settings: [[2, 12, 28, 8], [12, 2, 8, 28], [10, 10, 12, 12]],
};

/** Ikon navigasi 32x32 bergaya piksel. */
export function NavIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      {ICONS[name].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} style={ink} />
      ))}
    </svg>
  );
}

export type SparkleColor = 'yellow' | 'pink' | 'turquoise';

/** Hiasan tanda plus (layar G6 & G8b). */
export function Sparkle({ left, top, size, color }: { left: number; top: number; size: number; color: SparkleColor }) {
  const bar = size / 4;
  const mid = (size - bar) / 2;
  const style = { left, top, width: size, height: size, '--sparkle-color': `var(--brand-${color})` } as CSSProperties;
  return (
    <span className="sparkle" style={style} aria-hidden>
      <span className="sparkle__h" style={{ left: 0, top: mid, width: size, height: bar }} />
      <span className="sparkle__v" style={{ left: mid, top: 0, width: bar, height: size }} />
    </span>
  );
}
