import type { CSSProperties } from 'react';

/** Nomor slot di pojok foto. */
export function SlotBadge({ number, style, className }: { number: number | string; style?: CSSProperties; className?: string }) {
  return (
    <span className={['slot-badge', className].filter(Boolean).join(' ')} style={style}>
      {number}
    </span>
  );
}
