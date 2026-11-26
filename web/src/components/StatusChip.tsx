import type { ReactNode } from 'react';

export type ChipTone = 'ok' | 'warn' | 'bad' | 'neutral';
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed';

const STATUS: Record<UploadStatus, { tone: ChipTone; label: string }> = {
  queued: { tone: 'neutral', label: 'Antre' },
  uploading: { tone: 'warn', label: 'Mengunggah' },
  done: { tone: 'ok', label: 'Selesai' },
  failed: { tone: 'bad', label: 'Gagal' },
};

interface Props {
  tone?: ChipTone;
  /** Pintasan untuk status upload (menentukan warna + teks bila `children` kosong). */
  status?: UploadStatus;
  children?: ReactNode;
  className?: string;
}

export function StatusChip({ status, tone, children, className }: Props) {
  const resolved = tone ?? (status ? STATUS[status].tone : 'neutral');
  const text = children ?? (status ? STATUS[status].label : null);
  return (
    <span className={['chip', `chip--${resolved}`, className].filter(Boolean).join(' ')}>
      <span className="chip__dot" />
      <span>{text}</span>
    </span>
  );
}
