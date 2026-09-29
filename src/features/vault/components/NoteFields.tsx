import { Label, TextArea } from "@/components/form";
import type { useNoteForm } from "../hooks/use-note-form";

// The note part of the item form: one roomy box. A note has no separate Notes field.
export function NoteFields({ note }: { note: ReturnType<typeof useNoteForm> }) {
  return (
    <Label text="Note">
      <TextArea
        value={note.body ?? ""}
        onChange={(e) => note.setBody(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder="PINs, door codes, anything private"
        className="min-h-[196px] resize-y! leading-relaxed"
      />
    </Label>
  );
}
