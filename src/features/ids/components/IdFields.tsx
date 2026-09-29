import { useState, type ReactNode } from "react";
import { IdentificationCard } from "@phosphor-icons/react";
import { EyeButton, Label, Select, TextInput } from "@/components/form";
import { keys } from "@/lib/platform";
import { PhotoField } from "@/components/photo";
import { ID_TYPES, OTHER } from "../lib/ids";
import type { useIdForm } from "../hooks/use-id-form";

type IdForm = ReturnType<typeof useIdForm>;

// The ID part of the item form: which ID (Other: typed), its number, and an optional photo of it. The
// title comes last: left empty, the item is named after the ID.
export function IdFields({ idCard, titleRow }: { idCard: IdForm; titleRow: ReactNode }) {
  const [shown, setShown] = useState(false);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Label text="ID">
          <Select autoFocus value={idCard.other ? OTHER : idCard.idType} onChange={(e) => (e.target.value === OTHER ? idCard.pickType("", true) : idCard.pickType(e.target.value, false))}>
            <option value="" disabled>
              Choose one
            </option>
            {[...ID_TYPES, OTHER].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        </Label>
        {idCard.other && (
          <Label text="Which ID">
            <TextInput autoFocus value={idCard.idType} onChange={(e) => idCard.pickType(e.target.value, true)} placeholder="Barangay ID" autoComplete="off" />
          </Label>
        )}
        <Label text="ID number">
          <div className="relative">
            <TextInput
              type={shown ? "text" : "password"}
              value={idCard.idNumber ?? ""}
              onChange={(e) => idCard.setIdNumber(e.target.value)}
              placeholder="As printed on the card"
              spellCheck={false}
              autoComplete="off"
              className="pr-11 font-mono"
            />
            <EyeButton shown={shown} what="ID number" onClick={() => setShown(!shown)} className="absolute right-1.5 top-1/2 -translate-y-1/2" />
          </div>
        </Label>
      </div>
      <PhotoField
        label="ID photo"
        photo={idCard.photo}
        error={idCard.error}
        empty={{
          icon: (
            <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent">
              <IdentificationCard size={20} weight="bold" />
            </span>
          ),
          title: "Add a photo",
          hint: `Pick a photo of the ID, or paste one (${keys("mod", "V")})`,
        }}
        pickAgain="Replace"
        onImage={idCard.addPhoto}
        onShow={idCard.showPhoto}
        onRemove={idCard.removePhoto}
      />
      {titleRow}
    </>
  );
}
