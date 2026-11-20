const SEGMENTS = 10;

/** Warna segmen mengikuti Figma: 1-2 pink kuat, 3 pink, 4-6 oranye, 7-8 kuning, 9-10 turquoise. */
const colorOf = (i: number): number => (i < 2 ? 1 : i < 3 ? 2 : i < 6 ? 3 : i < 8 ? 4 : 5);

/** Progress bar bergaya piksel. `filled` = jumlah segmen terisi (0..10). */
export function SegmentedBar({ filled, size = 'md' }: { filled: number; size?: 'md' | 'sm' }) {
  const n = Math.max(0, Math.min(SEGMENTS, Math.round(filled)));
  return (
    <div className={size === 'sm' ? 'segbar segbar--sm' : 'segbar'} role="progressbar" aria-valuenow={n} aria-valuemax={SEGMENTS}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={i < n ? `segbar__seg segbar__seg--${colorOf(i)}` : 'segbar__seg'} />
      ))}
    </div>
  );
}

/** Isi bar menurut hitung mundur: count 5 dari 5 -> 2 segmen, count 1 -> 10 segmen. */
export function countdownFill(count: number, total: number): number {
  if (total <= 0) return SEGMENTS;
  return Math.ceil(((total - count + 1) / total) * SEGMENTS);
}
