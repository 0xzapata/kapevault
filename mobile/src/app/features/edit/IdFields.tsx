import { useRef, useState } from "react";
import { IdentificationCard } from "@phosphor-icons/react";
import { ID_TYPES } from "@core";
import { textLink } from "../../components/buttons";
import { ErrorText, Label, Select, TextInput } from "../../components/form";
import { PhotoTile } from "../../components/photo";
import { preparePhoto } from "../../lib/photo";
import { SecretInput } from "./inputs";
import { SpaceField, TitleField } from "./OtherFields";
import type { Draft, SetDraft } from "./use-item-form";
import type { Space } from "../../host/types";

const OTHER = "Other";

// The PC's ID fields: which ID (Other: typed), its number, a photo of it, then the title, which left
// empty follows the ID.
export function IdFields({ draft, set, spaces, autoTitle, showPhoto }: { draft: Draft; set: SetDraft; spaces: Space[]; autoTitle: string; showPhoto: () => void }) {
  return (
    <>
      <Label text="ID">
        <Select
          value={draft.idOther ? OTHER : draft.idType}
          onChange={(e) => {
            const other = e.target.value === OTHER;
            set("idOther", other);
            set("idType", other ? "" : e.target.value);
          }}
        >
          <option value="" disabled>
            Choose one
          </option>
          {[...ID_TYPES, OTHER].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </Select>
      </Label>
      {draft.idOther && (
        <Label text="Which ID">
          <TextInput autoFocus value={draft.idType} onChange={(e) => set("idType", e.target.value)} placeholder="Barangay ID" autoComplete="off" />
        </Label>
      )}
      <SecretInput label="ID number" value={draft.idNumber} onChange={(v) => set("idNumber", v)} />
      <IdPhoto photo={draft.photo} onPhoto={(photo) => set("photo", photo)} showPhoto={showPhoto} />
      <TitleField draft={draft} set={set} label="Title (optional)" placeholder={autoTitle || "Passport"} />
      <SpaceField draft={draft} set={set} spaces={spaces} />
    </>
  );
}

// Optional. Picked through Android's own chooser (camera or files); a saved one is identity data, so it
// stays hidden (not even loaded) until Show photo.
function IdPhoto({ photo, onPhoto, showPhoto }: { photo: string | null; onPhoto: (photo: string) => void; showPhoto: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(0); // a photo still being made never lands after a newer pick or Remove
  const [error, setError] = useState("");
  const pick = () => picker.current?.click();

  async function add(image: File) {
    const run = ++latest.current;
    setError("");
    try {
      const { photo: made } = await preparePhoto(image, false);
      if (run === latest.current) onPhoto(made);
    } catch (e) {
      if (run === latest.current) setError(e instanceof Error ? e.message : "Could not use that photo. Try another one.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        aria-label="ID photo"
        onChange={(e) => {
          const image = e.target.files?.[0];
          e.target.value = ""; // the same photo can be picked again
          if (image) void add(image);
        }}
      />
      {photo === "" ? (
        <button type="button" onClick={pick} className="press flex w-full items-center gap-3.5 rounded-[14px] border border-dashed border-line-strong px-4 py-3.5 text-left focus-ring">
          <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent">
            <IdentificationCard size={20} weight="bold" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-ink">Add a photo</span>
            <span className="block text-[12.5px] text-ink-3">Take one, or pick one from your files</span>
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-3.5 rounded-[14px] bg-field p-2.5 pr-2">
          <PhotoTile photo={photo} label="ID photo" className="size-[60px] rounded-[10px]" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">ID photo</p>
            <div className="-ml-1 flex flex-wrap">
              {photo === null && (
                <button type="button" onClick={showPhoto} className={textLink}>
                  Show photo
                </button>
              )}
              <button type="button" onClick={pick} className={textLink}>
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  latest.current++;
                  onPhoto("");
                }}
                className="press flex min-h-11 items-center px-1 text-[12.5px] font-medium text-ink-3 focus-ring"
              >
                Remove photo
              </button>
            </div>
          </div>
        </div>
      )}
      <ErrorText message={error} />
    </div>
  );
}
