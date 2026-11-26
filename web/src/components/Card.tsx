import type { ReactNode } from 'react';

/** Kartu putih bergaris tipis; `sub` = keterangan kecil di bawah judul, `aside` = elemen di kanan judul. */
export function Card({
  title,
  sub,
  aside,
  children,
  className,
}: {
  title?: string;
  sub?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {(title || aside) && (
        <div className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {sub && <p className="card__sub">{sub}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
