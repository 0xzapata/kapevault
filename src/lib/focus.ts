// Focus mechanics shared by the modals (Sheet's useModal), the Popover and the Menu: what Tab can reach,
// and where the focus goes back to when a modal closes.

// Everything that can be a Tab stop; isTabStop then drops the ones that are not right now.
const CANDIDATES = [
  "a[href]",
  "area[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "iframe",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "details > summary:first-of-type",
  "[tabindex]",
].join(", ");

// A candidate is a stop unless it is disabled, inert, out of the Tab order (tabindex="-1": a roving tile
// group's other tiles), not drawn (hidden, display none, visibility hidden, inside a closed <details>),
// or an unchecked radio whose group has a checked one (the group is one stop, on its checked radio).
function isTabStop(el: HTMLElement): boolean {
  if (el.matches(":disabled") || el.closest("[inert]")) return false;
  if (el.hasAttribute("tabindex") && el.tabIndex < 0) return false;
  if (!el.checkVisibility({ visibilityProperty: true })) return false;
  if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked && el.name) {
    const scope = el.form ?? el.ownerDocument;
    if (scope.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`)) return false;
  }
  return true;
}

// The Tab stops inside root, in the order Tab visits them: a positive tabindex first, then the page order.
export function tabStops(root: HTMLElement): HTMLElement[] {
  const rank = (el: HTMLElement) => (el.tabIndex > 0 ? el.tabIndex : Number.MAX_SAFE_INTEGER);
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(isTabStop).sort((a, b) => rank(a) - rank(b));
}

// A video, an audio or a frame has Tab stops of its own that the page cannot see (its controls, the
// document in it), so Tab goes through them natively.
export const hasInnerStops = (el: Element | null) => el instanceof HTMLMediaElement || el instanceof HTMLIFrameElement;

// A modal's opener can be gone by the time it closes: a menu item unmounts in the commit that opens the
// sheet, and a save remounts the detail pane its Edit button sat in. A menu names who takes over.
const handedTo = new WeakMap<Element, HTMLElement>();
export function handFocusTo(from: Element, to: HTMLElement | null) {
  if (to) handedTo.set(from, to);
}

const canTakeFocus = (el: HTMLElement | null) =>
  Boolean(el && el !== document.body && el.isConnected && !el.closest("[inert]") && el.checkVisibility());

// Where the focus goes back to when a modal closes: the opener; else the element that replaced it (the
// same data-focus-key); else whoever it was handed to (a menu: what had the focus before it opened).
// Failing all of those, the first data-focus-home on screen (the item list, else the item's heading).
export function returnFocus(opener: HTMLElement | null) {
  for (let el = opener, hops = 0; el && hops < 4; hops++) {
    if (canTakeFocus(el)) return el.focus();
    const key = el.dataset.focusKey;
    const replacement = key ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null;
    if (replacement && canTakeFocus(replacement)) return replacement.focus();
    let next: HTMLElement | null = null;
    for (let at: Element | null = el; at && !next; at = at.parentElement) next = handedTo.get(at) ?? null;
    el = next;
  }
  [...document.querySelectorAll<HTMLElement>("[data-focus-home]")].find(canTakeFocus)?.focus();
}
