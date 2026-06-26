// Shared flat (outline/solid) SVG icon set — Lucide-style. No emoji anywhere.

export type IconName =
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "shuffle"
  | "repeat"
  | "repeat-one"
  | "volume"
  | "fullscreen"
  | "search"
  | "home"
  | "plus"
  | "x"
  | "up"
  | "speaker"
  | "headphones"
  | "leave";

const PATHS: Record<IconName, string> = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  prev: "M7 6v12M19 6 9 12l10 6V6z",
  next: "M17 6v12M5 6l10 6-10 6V6z",
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  "repeat-one":
    "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3M11 14v-3l-1 1",
  volume: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  up: "M12 5l7 9H5z",
  speaker: "M9 4h6v16H9zM12 8h.01M12 14a2 2 0 1 0 0 .01",
  headphones: "M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v6H6a2 2 0 0 1-2-2zM20 13h-3v6h1a2 2 0 0 0 2-2z",
  leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};

const SOLID = new Set<IconName>(["play", "pause", "prev", "next", "up"]);

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const solid = SOLID.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block" }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
