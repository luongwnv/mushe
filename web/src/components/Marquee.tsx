import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  className?: string;
}

// A fixed-width label that truncates normally, but if the text overflows
// its container, scrolls it right-to-left on loop instead of just cutting
// it off with an ellipsis. The wrapper's width never changes — only the
// text scrolls inside it, so surrounding layout (queue rows, search
// results, the player card) never grows to fit long titles.
export function Marquee({ text, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // Measure the text's true intrinsic width in a probe appended straight
    // to <body>, reusing the wrapper's own class list so every relevant
    // rule (font, weight, letter-spacing, ...) applies via the real CSS
    // cascade instead of a hand-copied subset. Measuring in place (even
    // absolutely positioned) inside an `overflow: hidden` ancestor clamps
    // shrink-to-fit width to the ancestor's own width instead of the
    // text's real content width, which silently reports "not overflowing"
    // for titles that clearly are — hence probing outside the tree.
    const probe = document.createElement("div");
    probe.className = wrap.className;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = "auto";
    probe.style.maxWidth = "none";
    probe.style.whiteSpace = "pre";
    probe.textContent = text;
    document.body.appendChild(probe);

    const measure = () => setOverflowing(probe.getBoundingClientRect().width > wrap.clientWidth + 1);
    measure();
    // Web fonts (Silkscreen / Space Grotesk) can finish loading after this
    // first measurement, changing the text's actual rendered width.
    document.fonts?.ready.then(measure).catch(() => {});
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      document.body.removeChild(probe);
    };
  }, [text]);

  return (
    <div ref={wrapRef} className={className ? `marquee ${className}` : "marquee"}>
      <span
        className={overflowing ? "marquee-track" : "marquee-static"}
        style={overflowing ? { animationDuration: `${Math.max(6, text.length * 0.22)}s` } : undefined}
      >
        {text}
        {overflowing && <span className="marquee-gap" aria-hidden>{text}</span>}
      </span>
    </div>
  );
}
