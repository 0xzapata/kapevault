// settings.json: this phone's settings and its install id (the name of its folder in R2, and the id
// sync stamps its changes with). Plain JSON, never anything about the vault's contents; never synced.
import type { LockAfterHours, LockGrace, PhoneSettings, ThemeChoice } from "./types";
import type { Store } from "./storage";

const FILE = "settings.json";
const GRACE: LockGrace[] = [0, 30, 60];
const HOURS: LockAfterHours[] = [0, 1, 2, 4, 8, 12, 24];
const THEMES: ThemeChoice[] = ["system", "classic", "dark", "colorblind", "contrast"];
const DEFAULTS: PhoneSettings = { lockGrace: 30, lockAfterHours: 8, theme: "system", hideFromCapture: true };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only known values get through, from the file or from the page.
export function cleanSettings(value: Partial<Record<keyof PhoneSettings, unknown>>, base: PhoneSettings = DEFAULTS): PhoneSettings {
  const pick = <T>(v: unknown, allowed: T[], fallback: T) => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    lockGrace: pick(value.lockGrace, GRACE, base.lockGrace),
    lockAfterHours: pick(value.lockAfterHours, HOURS, base.lockAfterHours),
    theme: pick(value.theme, THEMES, base.theme),
    hideFromCapture: pick(value.hideFromCapture, [true, false], base.hideFromCapture),
  };
}

export async function loadSettings(store: Store, now: () => number): Promise<{ installId: string; settings: PhoneSettings }> {
  const text = await store.read(FILE);
  let saved: Record<string, unknown> | null = null;
  try {
    saved = text === null ? null : JSON.parse(text);
  } catch {
    // Damaged: kept aside, never silently replaced.
    await store.write(`settings-unreadable-${now()}.json`, text as string).catch(() => {});
  }
  const settings = cleanSettings(saved ?? {});
  const installId = typeof saved?.installId === "string" && ID.test(saved.installId) ? saved.installId : crypto.randomUUID();
  if (saved?.installId !== installId) await saveSettings(store, installId, settings);
  return { installId, settings };
}

export async function saveSettings(store: Store, installId: string, settings: PhoneSettings) {
  await store.write(FILE, JSON.stringify({ installId, ...settings }));
}
