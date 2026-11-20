import { useEffect, useRef, type RefObject } from 'react';

/** Tampilan langsung webcam. `mirror` hanya membalik tampilan, bukan foto yang diambil. */
export function LiveVideo({
  stream,
  mirror,
  videoRef,
  className = 'viewfinder__media',
}: {
  stream: MediaStream | null;
  mirror: boolean;
  /** Opsional: ref dari luar (booth butuh elemen <video> untuk menjepret). */
  videoRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
}) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? ownRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream, ref]);

  return (
    <video
      ref={ref}
      className={className}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      autoPlay
      muted
      playsInline
      tabIndex={-1}
    />
  );
}
