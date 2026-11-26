import type { ReactNode } from 'react';

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'toggle toggle--on' : 'toggle'}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

export function SwitchRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="switch-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** <select> berlabel. `options` = [nilai, teks]. */
export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="field__label">{label}</label>
      <select className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
