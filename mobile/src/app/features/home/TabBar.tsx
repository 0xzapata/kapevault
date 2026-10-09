import { useLayoutEffect, useRef } from "react";
import { Clock, Gear, ShieldWarning, SquaresFour } from "@phosphor-icons/react";
import { reducedMotion, stepResponse } from "../../lib/spring";

export type Tab = "items" | "codes" | "security" | "settings";

const TABS = [
  { id: "items", label: "Items", Icon: SquaresFour, weight: "fill" },
  { id: "codes", label: "2FA codes", Icon: Clock, weight: "bold" },
  { id: "security", label: "Security", Icon: ShieldWarning, weight: "fill" },
  { id: "settings", label: "Settings", Icon: Gear, weight: "fill" },
] as const;

// The pill sits this far inside its tab, px; the tab is 54 px tall.
const PILL_X = 7;
const PILL_Y = 4;
const H = 54 - 2 * PILL_Y;
// Liquid: each edge rides its own spring. The leading edge is quicker and overshoots a touch, the trailing
// one softer, so the pill stretches toward the new tab, thins, and gathers there in one continuous motion.
const LEAD = stepResponse(0.28, 0.78);
const TRAIL = stepResponse(0.42, 0.9);
const THIN = 0.12; // at most 12% thinner while stretched
const FRAME = 1 / 60;
const MID = 100; // the middle bar's width before its scale, px

// The pill is three pieces moved by transform only, so the motion runs on the compositor and keeps going
// while the page renders the new tab: a round cap at each edge and a bar between their centres.
type Edges = { l: number; r: number };
type Pose = [capL: string, capR: string, mid: string];
function pose({ l, r }: Edges, rest: number): Pose {
  const k = 1 - THIN * Math.min(1, Math.max(0, r - l - rest) / 120);
  return [`translateX(${l}px) scale(${k})`, `translateX(${r - H}px) scale(${k})`, `translateX(${l + H / 2}px) scale(${Math.max(0, r - l - H) / MID}, ${k})`];
}
// The edges frame by frame, from where the pill is to the new tab, until both springs have settled.
function path(from: Edges, to: Edges): Edges[] {
  const right = to.l > from.l;
  const [left, rightEdge] = right ? [TRAIL, LEAD] : [LEAD, TRAIL];
  const frames: Edges[] = [];
  for (let t = 0; t <= 1; t += FRAME) {
    const [pl, pr] = [left(t), rightEdge(t)];
    frames.push({ l: from.l + (to.l - from.l) * pl, r: from.r + (to.r - from.r) * pr });
    if (t > 0.1 && Math.abs(1 - pl) < 0.002 && Math.abs(1 - pr) < 0.002) break;
  }
  frames.push(to);
  return frames;
}

// The phone's bottom tab bar, 94% opaque with a scroll-edge fade above it, and a pill
// under the selected tab that flows to the next one.
export function TabBar({ tab, issues, onTab }: { tab: Tab; issues: number; onTab: (t: Tab) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const pieces = useRef<HTMLSpanElement[]>([]);
  const flight = useRef<{ frames: Edges[]; anims: Animation[] } | null>(null);
  const at = useRef<Edges | null>(null);

  useLayoutEffect(() => {
    const box = row.current;
    const parts = pieces.current;
    if (!box || parts.length !== 3) return;
    const edgesOf = (id: Tab): Edges => {
      const b = box.querySelector<HTMLElement>(`[data-tab="${id}"]`);
      return b ? { l: b.offsetLeft + PILL_X, r: b.offsetLeft + b.offsetWidth - PILL_X } : { l: 0, r: 0 };
    };
    const rest = () => (box.querySelector<HTMLElement>("[data-tab]")?.offsetWidth ?? 0) - 2 * PILL_X;
    // Where the pill is now, mid-flight included: the frame the running animation has reached.
    const now = (): Edges | null => {
      const f = flight.current;
      if (!f) return at.current;
      const i = Math.min(f.frames.length - 1, Math.round(Number(f.anims[0].currentTime ?? 0) / (FRAME * 1000)));
      return f.anims[0].playState === "finished" ? at.current : f.frames[i];
    };
    const place = (edges: Edges) => {
      const p = pose(edges, rest());
      for (const [i, el] of parts.entries()) el.style.transform = p[i];
    };

    const to = edgesOf(tab);
    const from = now();
    for (const a of flight.current?.anims ?? []) a.cancel();
    flight.current = null;
    at.current = to;
    place(to);
    if (from && !reducedMotion() && Math.abs(from.l - to.l) > 1) {
      const frames = path(from, to);
      const poses = frames.map((f) => pose(f, rest()));
      const ms = (frames.length - 1) * FRAME * 1000;
      flight.current = { frames, anims: parts.map((el, i) => el.animate(poses.map((p) => ({ transform: p[i] })), { duration: ms })) };
    }

    let width = box.clientWidth;
    const resized = new ResizeObserver(() => {
      if (box.clientWidth === width) return; // it also fires once on observe(), mid-flight
      width = box.clientWidth;
      for (const a of flight.current?.anims ?? []) a.cancel();
      flight.current = null;
      at.current = edgesOf(tab);
      place(at.current);
    });
    resized.observe(box);
    return () => resized.disconnect();
  }, [tab]);

  const piece = "tab-pill pointer-events-none absolute left-0 will-change-transform";
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML allows role tablist on a nav
    <nav role="tablist" aria-label="KAPEVault" data-bottom-chrome className="bottom-bar z-20 shrink-0 px-2 pb-[var(--sab)] pt-0.5">
      <div ref={row} className="relative flex">
        {/* The bar first, the caps over it: each end of the scaled bar sits under a solid cap, so no seam shows. */}
        <span aria-hidden data-pill ref={(el) => {
          if (el) pieces.current[2] = el;
        }} className={`${piece} origin-left`} style={{ top: PILL_Y, width: MID, height: H }} />
        <span aria-hidden data-pill ref={(el) => {
          if (el) pieces.current[0] = el;
        }} className={`${piece} rounded-full`} style={{ top: PILL_Y, width: H, height: H }} />
        <span aria-hidden data-pill ref={(el) => {
          if (el) pieces.current[1] = el;
        }} className={`${piece} rounded-full`} style={{ top: PILL_Y, width: H, height: H }} />
        {TABS.map(({ id, label, Icon, weight }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              data-tab={id}
              aria-selected={on}
              onClick={() => onTab(id)}
              className={`press track-small relative flex h-[54px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold focus-ring [--focus-ring-offset:-2px] ${on ? "text-accent" : "text-ink-3"}`}
            >
              <Icon size={22} weight={weight} />
              {label}
              {id === "security" && issues > 0 && (
                <span role="img" aria-label={`${issues} to fix`} className="absolute left-[calc(50%+6px)] top-1.5 rounded-full bg-sys-red px-[5px] text-[11px] font-[650] leading-[17px] text-on-accent">
                  {issues}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
