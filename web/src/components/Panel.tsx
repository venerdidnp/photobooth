import type { CSSProperties, ReactNode } from 'react';

export function PanelHeader({ title }: { title: string }) {
  return (
    <div className="panel-header">
      <span className="panel-header__bullet" />
      <h2 className="t-label-m nowrap">{title}</h2>
    </div>
  );
}

/** Panel operator: kartu krem dengan border tinta dan bayangan keras. */
export function Panel({
  title,
  children,
  style,
  className,
}: {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section className={['panel', className].filter(Boolean).join(' ')} style={style}>
      {title && <PanelHeader title={title} />}
      {children}
    </section>
  );
}
