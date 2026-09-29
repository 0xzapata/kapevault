import { useRef, useState } from "react";
import { vaultApi } from "@/lib/vault-api";

// A photo on the item form (a device's label, an ID): "" none, null saved but not loaded - it shows
// what the item keeps secret, so it loads only on show(), and a null photo keeps the stored one on Save.
export function usePhotoSlot(entry: { id: string; hasPhoto: boolean } | null) {
  const [photo, setPhoto] = useState<string | null>(entry?.hasPhoto ? null : "");
  const latest = useRef(0); // a photo still being made never lands after a newer pick or Remove

  // A new pick: the returned check is true while no newer pick or Remove has come.
  function begin() {
    const run = ++latest.current;
    return () => run === latest.current;
  }

  function remove() {
    latest.current++;
    setPhoto("");
  }

  async function show() {
    if (!entry?.hasPhoto) return;
    try {
      const stored = await vaultApi.getSecret(entry.id, "photo");
      setPhoto((p) => p ?? stored); // a new pick or Remove while it loaded wins
    } catch {
      // Locked: the lock screen takes over.
    }
  }

  return { photo, setPhoto, begin, remove, show };
}
