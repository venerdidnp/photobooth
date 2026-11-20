import type { CSSProperties } from 'react';

/** Slot Badge (Figma 3:55): nomor slot di pojok foto. */
export function SlotBadge({ number, style }: { number: number | string; style?: CSSProperties }) {
  return (
    <span className="slot-badge" style={style}>
      {number}
    </span>
  );
}
