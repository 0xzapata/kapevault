import { useEffect, useState } from "react";
import { vaultApi, type LabelFound } from "@/lib/vault-api";
import { isIpcError } from "@/lib/ipc-message";
import type { DeviceEntry, EntryInput } from "@/features/vault/types";
import { applyFound, draftFrom, foundCount, type DeviceDraft } from "../lib/devices";
import { preparePhoto } from "@/lib/photo";
import { usePhotoSlot } from "@/hooks/use-photo-slot";

// After a scan: what it read, in words the form shows under the photo.
export type ScanStatus = "idle" | "reading" | "found" | "nothing" | "unavailable";

const STORED = ["adminPassword", "wifiPassword"] as const;

// The device part of the item form: its fields, the label photo, and "Scan a label". onFound gets
// what a scan read, for the fields the form itself owns (title, notes).
export function useDeviceForm(entry: DeviceEntry | null, onFound: (found: LabelFound) => void) {
  const [draft, setDraft] = useState<DeviceDraft>(() => draftFrom(entry));
  const slot = usePhotoSlot(entry); // the label photo shows the passwords in clear
  const [found, setFound] = useState<LabelFound | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState("");

  // Editing loads the stored passwords into their masked fields, each only if nothing was typed while it
  // loaded.
  useEffect(() => {
    if (!entry) return;
    const has = { adminPassword: entry.hasAdminPassword, wifiPassword: entry.hasWifiPassword };
    for (const field of STORED) {
      if (!has[field]) continue;
      vaultApi.getSecret(entry.id, field).then(
        (stored) => setDraft((d) => ({ ...d, [field]: d[field] ?? stored })),
        () => {}, // locked mid-edit: the lock screen takes over, and a null field keeps the saved value
      );
    }
  }, [entry]);

  const set = (patch: Partial<DeviceDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // A picked, pasted or dropped photo: kept as the label photo, then read by Windows. Nothing is saved
  // until the user presses Save.
  async function read(image: Blob) {
    const current = slot.begin(); // a second photo while the first is still being read wins
    setStatus("reading");
    setError("");
    try {
      const { photo, scan } = await preparePhoto(image);
      const result = await vaultApi.readLabel(scan);
      if (!current()) return;
      slot.setPhoto(photo);
      if (!result.ok) throw new Error(result.error);
      if (result.reader === "unavailable") return setStatus("unavailable");
      setDraft((d) => applyFound(d, result.found));
      setFound(result.found);
      setStatus(foundCount(result.found) ? "found" : "nothing");
      onFound(result.found);
    } catch (e) {
      if (!current()) return;
      setStatus("idle");
      setError(e instanceof Error && !isIpcError(e) ? e.message : "Could not read that photo. Try another one.");
    }
  }

  function removePhoto() {
    slot.remove(); // a photo still being read must not come back
    setStatus("idle");
  }

  // "from label" beside a field while it still holds what the scan read.
  const fromLabel = (field: keyof LabelFound, value: string | null) => Boolean(found?.[field]) && found?.[field] === value;

  // What Save sends: a secret or the photo still null keeps the stored one.
  const input = (): Partial<EntryInput> => {
    const { adminPassword, wifiPassword, ...fields } = draft;
    return { ...fields, adminPassword: adminPassword ?? undefined, wifiPassword: wifiPassword ?? undefined, photo: slot.photo ?? undefined };
  };

  return { draft, set, photo: slot.photo, status, error, count: found ? foundCount(found) : 0, read, removePhoto, showPhoto: slot.show, fromLabel, input };
}
