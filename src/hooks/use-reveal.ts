import { useState } from "react";

// A stored secret shown on request: fetched from main only when toggled on, and dropped from the page
// when toggled off. A failed fetch leaves it hidden - the vault locked (the lock screen takes over) or
// the item changed (the next view says so). setValue updates what is shown (a code ticked off).
export function useReveal<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);

  async function toggle() {
    if (value !== null) return setValue(null);
    try {
      setValue(await load());
    } catch {
      // Hidden it stays; see above.
    }
  }

  return { value, setValue, toggle };
}
