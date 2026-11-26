/** Bar progres tipis. `value` 0..1. */
export function Progress({ value, size, stage }: { value: number; size?: 'sm'; stage?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const cls = ['progress', size === 'sm' && 'progress--sm', stage && 'progress--stage'].filter(Boolean).join(' ');
  return (
    <div className={cls} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
