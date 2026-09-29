import { useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { preparePhoto } from "@/lib/photo";
import { usePhotoSlot } from "@/hooks/use-photo-slot";
import type { EntryInput, IdEntry } from "@/features/vault/types";
import { ID_TYPES } from "../lib/ids";

// The ID part of the item form. Editing loads the saved number into its masked field (like a device's
// passwords); the photo stays null (saved, not loaded) until showPhoto. A null secret keeps the stored one.
// An ID left untitled is saved under its type (autoTitle).
export function useIdForm(entry: IdEntry | null) {
  const [idType, setIdType] = useState(entry?.idType ?? "");
  const [other, setOther] = useState(Boolean(entry && !ID_TYPES.includes(entry.idType))); // typing a name of its own
  const [idNumber, setIdNumber] = useState<string | null>(entry?.hasNumber ? null : "");
  const slot = usePhotoSlot(entry);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entry?.hasNumber) return;
    vaultApi.getSecret(entry.id, "idNumber").then(
      (stored) => setIdNumber((n) => n ?? stored), // typed while it loaded: the typing wins
      () => {}, // locked mid-edit: the lock screen takes over
    );
  }, [entry]);

  function pickType(name: string, typed: boolean) {
    setOther(typed);
    setIdType(name);
  }

  async function addPhoto(image: Blob) {
    const current = slot.begin();
    setError("");
    try {
      const { photo } = await preparePhoto(image, false);
      if (current()) slot.setPhoto(photo);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Could not use that photo. Try another one.");
    }
  }

  const autoTitle = idType.trim();
  const problem = () => (autoTitle ? "" : other ? "Say which ID it is." : "Pick which ID it is.");
  const input = (): Partial<EntryInput> => ({ idType, idNumber: idNumber ?? undefined, photo: slot.photo ?? undefined });

  return { idType, other, pickType, idNumber, setIdNumber, photo: slot.photo, error, addPhoto, removePhoto: slot.remove, showPhoto: slot.show, autoTitle, problem, input };
}
