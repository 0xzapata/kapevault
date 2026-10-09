import { useState } from "react";
import { Button, ErrorText, Label, TextArea, TextInput } from "../../components/form";
import { KindTile } from "../../components/icons";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { canPlaceIn } from "../../host/pro";
import { KINDS } from "../../lib/entries";
import { useMoveToTrash } from "../trash/use-move-to-trash";
import { LoginFields } from "./LoginFields";
import { More } from "./inputs";
import { DeviceFields, DeviceTypeField, ExpiresField, KeyFields, LinkFields, NoteFields, SpaceField, ThingFields, TitleField } from "./OtherFields";
import { IdFields } from "./IdFields";
import { useItemForm } from "./use-item-form";
import type { Entry, Space } from "../../host/types";

interface ItemSheetProps {
  entry: Entry | null; // null = new item
  entries: Entry[];
  spaces: Space[];
  defaultSpaceId: string;
  defaultHeldFor?: string;
  pro: boolean; // KAPEVault Pro owned, from HomeScreen's status
  onSaved: (id: string) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

const TITLE_HINT = { login: "GitHub", note: "Server steps", key: "Cloudflare API", link: "Brand assets", thing: "Passport", device: "Home Wi-Fi router", id: "" };

// The PC's New item sheet, tall, with the kind tiles (3 + 3 + 2), the kind's fields, More
// options, and Cancel / Save in its footer, bottom right. It ends above the keyboard, so Save stays visible.
export function ItemSheet({ entry, entries, spaces, defaultSpaceId, defaultHeldFor, pro, onSaved, onDeleted, onClose }: ItemSheetProps) {
  const host = useHost();
  const toast = useToast();
  const moveToTrash = useMoveToTrash();
  const { draft, set, autoTitle, problem, input, showPhoto } = useItemForm(entry, defaultSpaceId, defaultHeldFor);
  const [more, setMore] = useState(Boolean(draft.tags || draft.heldFor));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [kindPicked, setKindPicked] = useState(false);
  const kind = draft.kind;
  // Without KAPEVault Pro, a client folder the item may not go to stays listed, greyed.
  const choices = spaces.map((s) => ({ ...s, locked: !canPlaceIn(pro, { spaces, entries }, { id: entry?.id, spaceId: s.id }) }));

  async function save(close: () => void) {
    if (saving) return;
    const stop = problem();
    if (stop) return setError(stop);
    setError("");
    setSaving(true);
    const result = await host.saveEntry(input());
    setSaving(false);
    if (!result.ok) return setError(/[.!?]$/.test(result.error) ? result.error : `${result.error}.`);
    toast("Saved");
    onSaved(result.id);
    close();
  }

  async function remove(close: () => void) {
    if (!entry || !(await moveToTrash(entry.id))) return;
    onDeleted(entry.id);
    close();
  }

  const titleSpace = (
    <>
      <TitleField draft={draft} set={set} placeholder={TITLE_HINT[kind]} />
      <SpaceField draft={draft} set={set} spaces={choices} />
    </>
  );

  return (
    <Sheet
      title={entry ? "Edit item" : "New item"}
      tall
      onClose={onClose}
      footer={(close) => (
        <>
          {entry && (
            <Button variant="danger" onClick={() => remove(close)}>
              Move to Trash
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => save(close)}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      )}
    >
      {() => (
        <form
          onSubmit={(e) => e.preventDefault()}
          className="mt-5 flex flex-col gap-4"
        >
          {!entry && (
            // biome-ignore lint/a11y/useSemanticElements: a labelled group of tiles in a grid sized by its parent; a fieldset adds its own box and min-width rules
            <div role="group" aria-label="Kind of item" className="grid grid-cols-3 gap-1.5">
              {KINDS.map((k) => {
                const on = k.value === kind;
                return (
                  <button
                    key={k.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setKindPicked(true);
                      set("kind", k.value);
                    }}
                    className={`press flex h-[62px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 focus-ring ${on ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-ink-2"}`}
                  >
                    <KindTile kind={k.value} />
                    <span className="w-full truncate text-center text-[12px] font-medium leading-none">{k.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* A picked kind's fields settle in rather than swap in one frame; not on open (the sheet has its own entrance). */}
          <div key={kind} className={`flex flex-col gap-4 ${kindPicked ? "settle" : ""}`}>
            {kind === "device" && <DeviceTypeField draft={draft} set={set} />}
            {kind !== "id" && titleSpace}
            {kind === "login" && <LoginFields draft={draft} set={set} entry={entry?.kind === "login" ? entry : null} entries={entries} />}
            {kind === "note" && <NoteFields draft={draft} set={set} />}
            {kind === "key" && <KeyFields draft={draft} set={set} />}
            {kind === "link" && <LinkFields draft={draft} set={set} />}
            {kind === "thing" && <ThingFields draft={draft} set={set} />}
            {kind === "device" && <DeviceFields key={draft.type} draft={draft} set={set} />}
            {kind === "id" && <IdFields draft={draft} set={set} spaces={choices} autoTitle={autoTitle} showPhoto={showPhoto} />}
          </div>

          {kind !== "note" && (
            <Label text="Notes">
              <TextArea value={draft.notes} onChange={(e) => set("notes", e.target.value)} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="none" />
            </Label>
          )}
          <More open={more} onOpen={() => setMore(true)}>
            <Label text="Held for">
              <TextInput value={draft.heldFor} onChange={(e) => set("heldFor", e.target.value)} placeholder="Sam" autoComplete="off" />
            </Label>
            <Label text="Tags">
              <TextInput value={draft.tags} onChange={(e) => set("tags", e.target.value)} placeholder="work, family" autoCapitalize="none" />
            </Label>
            {kind === "thing" && <ExpiresField draft={draft} set={set} />}
          </More>
          <ErrorText message={error} />
        </form>
      )}
    </Sheet>
  );
}
