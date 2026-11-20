import type { ReactNode } from 'react';

export type ChipTone = 'yellow' | 'orange' | 'turquoise' | 'danger';
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed';

const STATUS: Record<UploadStatus, { tone: ChipTone; label: string }> = {
  queued: { tone: 'yellow', label: 'QUEUED' },
  uploading: { tone: 'orange', label: 'UPLOADING' },
  done: { tone: 'turquoise', label: 'DONE' },
  failed: { tone: 'danger', label: 'FAILED' },
};

export const statusTone = (s: UploadStatus): ChipTone => STATUS[s].tone;

interface Props {
  tone?: ChipTone;
  /** Varian Figma: Queued / Uploading / Done / Failed (menentukan warna + teks bila `children` kosong). */
  status?: UploadStatus;
  children?: ReactNode;
  className?: string;
}

/** Status Chip (Figma 3:52). */
export function StatusChip({ status, tone, children, className }: Props) {
  const resolved = tone ?? (status ? STATUS[status].tone : 'yellow');
  const text = children ?? (status ? STATUS[status].label : null);
  return (
    <span className={['chip', `chip--${resolved}`, className].filter(Boolean).join(' ')}>
      <span className="chip__dot" />
      <span>{text}</span>
    </span>
  );
}
