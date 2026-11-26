import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Kanvas berukuran tetap (mis. 1920x1080) yang diskalakan memenuhi jendela dengan rasio tetap,
 * ditaruh di tengah. Sisa ruang diisi warna latar gelap.
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

/**
 * Menampilkan konten berukuran tetap (mis. cermin layar tamu 1920x1080) selebar kotak induknya,
 * dengan rasio tetap. Skala mengikuti lebar kotak.
 */
export function FitBox({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={ref} className="fit-box" style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="fit-box__inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
