import { useLayoutEffect, useState, type ReactNode } from 'react';

/**
 * Kanvas berukuran tetap (mis. 1920x1080) yang diskalakan memenuhi jendela dengan rasio tetap,
 * ditaruh di tengah. Sisa ruang diisi warna krem.
 */
export function Stage({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / width, window.innerHeight / height));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [width, height]);

  return (
    <div className="stage-viewport">
      <div
        className="stage"
        style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** Menampilkan konten berukuran tetap dalam kotak yang lebih kecil (mis. cermin layar tamu di panel operator). */
export function ScaleBox({
  width,
  height,
  scale,
  children,
}: {
  width: number;
  height: number;
  scale: number;
  children: ReactNode;
}) {
  return (
    <div className="scale-box" style={{ width: width * scale, height: height * scale }}>
      <div className="scale-box__inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
