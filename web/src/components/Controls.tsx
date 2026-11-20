interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange?: (value: number) => void;
  /** Tampilkan saja (tidak bisa diubah). */
  readOnly?: boolean;
}

/** Stepper - / nilai / + (O5 Settings). */
export function Stepper({ value, min, max, onChange, readOnly }: StepperProps) {
  const set = (v: number) => onChange?.(Math.min(max, Math.max(min, v)));
  return (
    <div className="stepper">
      <button type="button" className="stepper__btn" disabled={readOnly || value <= min} onClick={() => set(value - 1)} aria-label="decrease">
        -
      </button>
      <div className="stepper__value">{value}</div>
      <button type="button" className="stepper__btn" disabled={readOnly || value >= max} onClick={() => set(value + 1)} aria-label="increase">
        +
      </button>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'toggle toggle--on' : 'toggle'}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__knob" />
    </button>
  );
}
