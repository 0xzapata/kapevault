// Apple's spring (response + damping ratio) solved into a CSS linear() curve, so a plain CSS
// transition runs it and retargets from the live value when interrupted.
export function spring(response: number, damping: number) {
  const x = stepResponse(response, damping);
  let end = 2;
  for (let t = 0; t < 2; t += 1 / 240) {
    if (Math.abs(1 - x(t)) < 0.001 && Math.abs(1 - x(t + 0.08)) < 0.001) {
      end = t;
      break;
    }
  }
  const points = Array.from({ length: 41 }, (_, i) => (i === 40 ? "1" : x((end * i) / 40).toFixed(4)));
  return { ms: Math.round(end * 1000), ease: `linear(${points.join(", ")})` };
}

// The spring's progress at t seconds (0 -> 1, past 1 on an overshoot), for motion sampled frame by frame.
export function stepResponse(response: number, damping: number) {
  const w = (2 * Math.PI) / response;
  return (t: number) => {
    if (damping >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
    const wd = w * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
  };
}

export const SHEET = spring(0.34, 1); // drawer, push: no bounce
export const FLICK = spring(0.34, 0.8); // after a flick only: the gesture carried momentum

export function installSprings() {
  const root = document.documentElement.style;
  root.setProperty("--spring-dur", `${SHEET.ms}ms`);
  root.setProperty("--spring-ease", SHEET.ease);
  root.setProperty("--flick-dur", `${FLICK.ms}ms`);
  root.setProperty("--flick-ease", FLICK.ease);
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Apple's momentum projection (decelerationRate 0.998): where a release at v px/ms would come to rest.
export const project = (v: number, rate = 0.998) => (v * rate) / (1 - rate);

// Past an edge the element follows less and less.
export const rubberband = (overshoot: number, dimension: number, c = 0.55) => (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
