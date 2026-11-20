import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger';
/** Ukuran dari layar Figma: md = komponen dasar (22px); lainnya = varian di layar operator. */
export type ButtonSize = 'xs' | 'compact' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<ButtonSize, { font: number; py: number; px: number }> = {
  xs: { font: 16, py: 6, px: 18 }, // RETRY di tabel antrean
  compact: { font: 15, py: 14, px: 14 }, // CHANGE FOLDER / DISCONNECT
  sm: { font: 20, py: 16, px: 28 }, // CANCEL SESSION
  md: { font: 22, py: 18, px: 28 },
  lg: { font: 26, py: 26, px: 28 }, // FINISH & UPLOAD
  xl: { font: 32, py: 20, px: 28 }, // START SESSION
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

/** Button (Figma 3:39). */
export function Button({ variant = 'primary', size = 'md', block, className, style, type = 'button', ...rest }: Props) {
  const s = SIZES[size];
  const vars = {
    '--btn-font': `${s.font}px`,
    '--btn-py': `${s.py}px`,
    '--btn-px': `${s.px}px`,
    ...style,
  } as CSSProperties;
  return (
    <button
      type={type}
      className={['btn', `btn--${variant}`, block && 'btn--block', className].filter(Boolean).join(' ')}
      style={vars}
      {...rest}
    />
  );
}
