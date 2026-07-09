// Shared flat (outline/solid) SVG icon set — Lucide-style. No emoji anywhere.

export type IconName =
  | "play"
  | "pause"
  | "stop"
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
  | "chevron-down"
  | "share"
  | "heart"
  | "leave"
  | "clock"
  | "grip"
  | "tv"
  | "resize"
  | "note-plus";

const PATHS: Record<IconName, string> = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  stop: "M6 6h12v12H6z",
  // rewind: two left-pointing triangles (poolsuite-style)
  prev: "M11 6v12l-8-6zM21 6v12l-8-6z",
  // fast-forward: two right-pointing triangles
  next: "M3 6v12l8-6zM13 6v12l8-6z",
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
  "chevron-down": "M6 9l6 6 6-6",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z",
  leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  clock: "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2",
  grip: "M9 5h2v2H9zM13 5h2v2h-2zM9 11h2v2H9zM13 11h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z",
  tv: "M4 7h16v11H4zM9 21h6M8 3l4 4 4-4",
  resize: "M20 4h-6M20 4v6M20 4l-7 7",
  "note-plus": "M9 17V4.2l9-1.5v11.3M9 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM18 14a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 1v6M16 4h6",
};

const SOLID = new Set<IconName>(["play", "pause", "stop", "prev", "next", "up"]);

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
