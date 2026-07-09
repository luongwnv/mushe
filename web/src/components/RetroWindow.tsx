import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
  scroll?: boolean;
  right?: ReactNode;
}

// Classic Mac OS-style window chrome (title bar + traffic-light dots),
// the recurring "widget on a desktop" motif from poolsuite.net.
export default function RetroWindow({
  title,
  children,
  className,
  bodyClassName,
  noPad,
  scroll,
  right,
}: Props) {
  return (
    <section className={`win${className ? ` ${className}` : ""}`}>
      <div className="win-titlebar">
        <div className="win-dots">
          <span className="win-dot red" />
          <span className="win-dot yellow" />
          <span className="win-dot green" />
        </div>
        <div className="win-title">{title}</div>
        {right ? right : <div style={{ width: 41 }} />}
      </div>
      <div
        className={`win-body${noPad ? " no-pad" : ""}${scroll ? " scroll" : ""}${
          bodyClassName ? ` ${bodyClassName}` : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}
