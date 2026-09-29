import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isMac, type BiometricStatus } from "./vault-api";

// The one home of the OS check (vault-api reads it from the bridge).
export { isMac };

// Keyboard labels follow the OS: Ctrl on Windows, the Command glyph on a Mac.
const MOD = isMac ? "⌘" : "Ctrl";
const SHIFT = isMac ? "⇧" : "Shift";
const ALT = isMac ? "⌥" : "Alt";

// A shortcut written as parts, e.g. keys("mod", "shift", "C") -> "Ctrl Shift C" / "⌘⇧C".
export function keys(...parts: string[]): string {
  const mapped = parts.map((p) => (p === "mod" ? MOD : p === "shift" ? SHIFT : p === "alt" ? ALT : p));
  return mapped.join(isMac ? "" : " ");
}

// The primary modifier for this OS, from a keyboard event.
export const modPressed = (e: KeyboardEvent | ReactKeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

export const DEVICE = isMac ? "Mac" : "PC";

// Where a revealed file shows up.
export const explorerName = isMac ? "Finder" : "Explorer";

// Windows Hello / Touch ID: main's own name for it once the status arrives, the OS word before
// (so labels never flash empty).
export const biometricName = (status?: BiometricStatus | null) => status?.name ?? (isMac ? "Touch ID" : "Windows Hello");
