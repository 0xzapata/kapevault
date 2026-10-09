import { useId, useRef, useState, type FormEvent } from "react";
import { Sheet } from "@/components/Sheet";
import { MoreOptions } from "@/components/MoreOptions";
import { Button, ErrorText, Label, Select, TextArea, TextInput } from "@/components/form";
import { keys, modPressed } from "@/lib/platform";
import { ipcMessage } from "@/lib/ipc-message";
import { LogoPicker } from "@/features/brands/LogoPicker";
import { peopleHeldFor } from "@/features/held-for/lib/held-for";
import { COMMON_THINGS } from "@/features/things/lib/things";
import { ThingExpires, ThingFields } from "@/features/things/components/ThingFields";
import { useThingForm } from "@/features/things/hooks/use-thing-form";
import { DeviceFields, FromLabel } from "@/features/devices/components/DeviceFields";
import { useDeviceForm } from "@/features/devices/hooks/use-device-form";
import { IdFields } from "@/features/ids/components/IdFields";
import { useIdForm } from "@/features/ids/hooks/use-id-form";
import { KindPicker } from "./KindPicker";
import { LoginFields } from "./LoginFields";
import { NoteFields } from "./NoteFields";
import { KeyFields } from "./KeyFields";
import { LinkFields } from "./LinkFields";
import { useLoginForm } from "../hooks/use-login-form";
import { useNoteForm } from "../hooks/use-note-form";
import { useKeyForm } from "../hooks/use-key-form";
import { useLinkForm } from "../hooks/use-link-form";
import type { Entry, EntryInput, EntryKind, Space } from "../types";

interface EntryFormProps {
  entry: Entry | null; // null = new item
  entries: Entry[]; // for picking the account an OAuth login signs in through
  spaces: Space[];
  defaultSpaceId: string;
  defaultKind?: EntryKind; // preselected kind for a new item
  defaultHeldFor?: string; // a new item added from a person's list is theirs
  startScan?: boolean; // a device opened from "Scan a label": pick the photo straight away
  onSave: (input: EntryInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

const KINDS: { value: EntryKind; label: string }[] = [
  { value: "login", label: "Login" },
  { value: "note", label: "Secure note" },
  { value: "key", label: "API key" },
  { value: "link", label: "File link" },
  { value: "thing", label: "Thing" },
  { value: "device", label: "Device" },
  { value: "id", label: "ID" },
];

// Validation messages (a bad 2FA key or expiry) are shown as-is; anything else stays generic.
const VALIDATION = /2FA|setup key|HOTP|Authenticator|Expiry|Security questions|where it is kept|Grab|IMEI|MAC address|Photo could not|no room for more photos|device type|which ID|ID name|ID number/i;

function saveErrorMessage(err: unknown): string {
  const message = err instanceof Error ? ipcMessage(err) : "";
  if (!VALIDATION.test(message)) return "Could not save. If the vault locked, unlock it and try again.";
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

// The item form: the fields every kind shares (title, space, logo, notes, held for, tags) and the
// sheet around them. Each kind's own fields and state live in its hook + fields component; every hook
// runs whatever the kind, so a new item keeps what was typed when the kind is switched and back.
export function EntryForm({ entry, entries, spaces, defaultSpaceId, defaultKind, defaultHeldFor, startScan, onSave, onDelete, onClose }: EntryFormProps) {
  const peopleId = useId();
  const thingsId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const idEntry = entry?.kind === "id" ? entry : null;

  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? defaultKind ?? "login");
  // An ID saved untitled is its type: on edit it keeps following it.
  const followsAuto = idEntry && idEntry.title === idEntry.idType;
  const [title, setTitle] = useState(followsAuto ? "" : (entry?.title ?? ""));
  const [spaceId, setSpaceId] = useState(entry?.spaceId ?? defaultSpaceId);
  // The one field a login and an API key share, so it stays here.
  const [url, setUrl] = useState(entry?.kind === "login" || entry?.kind === "key" ? entry.url : "");
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [heldFor, setHeldFor] = useState(entry ? (entry.heldFor ?? "") : (defaultHeldFor ?? ""));
  const [moreOpen, setMoreOpen] = useState(Boolean(tags || heldFor || (entry?.kind === "thing" && entry.expires)));
  const [brand, setBrand] = useState<string | undefined>(entry?.brand);
  const login = useLoginForm(entry?.kind === "login" ? entry : null);
  const note = useNoteForm(entry?.kind === "note" ? entry : null);
  const apiKey = useKeyForm(entry?.kind === "key" ? entry : null);
  const link = useLinkForm(entry?.kind === "link" ? entry : null);
  const thing = useThingForm(entry?.kind === "thing" ? entry : null);
  const idCard = useIdForm(idEntry);
  // A label scan fills the title only if it is empty, and adds a CCTV box's verification code to the notes.
  const device = useDeviceForm(entry?.kind === "device" ? entry : null, (found) => {
    const { title: scannedTitle, notes: scannedNotes } = found;
    if (scannedTitle) setTitle((t) => (t.trim() ? t : scannedTitle));
    if (scannedNotes) setNotes((n) => (n.includes(scannedNotes) ? n : n.trim() ? `${n.trimEnd()}\n${scannedNotes}` : scannedNotes));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function buildInput(): EntryInput {
    const base = {
      id: entry?.id,
      kind,
      spaceId,
      title,
      notes,
      brand,
      heldFor,
      favorite: entry?.favorite ?? false,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (kind === "login") return { ...base, ...login.input(), url };
    if (kind === "note") return { ...base, ...note.input() };
    if (kind === "key") return { ...base, ...apiKey.input(), url };
    if (kind === "thing") return { ...base, ...thing.input() };
    if (kind === "device") return { ...base, ...device.input() };
    if (kind === "id") return { ...base, ...idCard.input(), title: title.trim() || idCard.autoTitle };
    return { ...base, ...link.input() };
  }

  // What stops a save, in words, in the order the form reads; "" when it can be saved.
  function problem(): string {
    if (kind === "id") return idCard.problem();
    if (!title.trim()) return "Give it a title.";
    if (kind === "thing") return thing.problem();
    return "";
  }

  async function submit(e: FormEvent, close: () => void) {
    e.preventDefault();
    if (saving) return;
    const stop = problem();
    if (stop) {
      setError(stop);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave(buildInput());
      close();
    } catch (err) {
      setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(close: () => void) {
    if (!entry) return;
    // No confirm: the item goes to the Trash and the Undo toast brings it back.
    try {
      await onDelete(entry.id);
      close();
    } catch {
      setError("Could not move it to the Trash. If the vault locked, unlock it and try again.");
    }
  }

  const spaceField = (
    <Label text="Space">
      <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </Label>
  );

  const titleRow = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Label text={kind === "id" ? "Title (optional)" : "Title"} hint={kind === "device" && <FromLabel show={device.fromLabel("title", title)} />}>
        <TextInput
          autoFocus={kind !== "id"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "id" ? idCard.autoTitle || "Passport" : kind === "thing" ? "Passport" : kind === "device" ? "Home Wi-Fi router" : "GitHub"}
          list={kind === "thing" ? thingsId : undefined}
          autoComplete="off"
        />
        {/* Common papers and keys come up as suggestions; any other name can be typed. */}
        {kind === "thing" && (
          <datalist id={thingsId}>
            {COMMON_THINGS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}
      </Label>
      {spaceField}
    </div>
  );

  return (
    <Sheet title={entry ? "Edit item" : "New item"} onClose={onClose}>
      {(close) => (
        <form
          ref={formRef}
          onSubmit={(e) => submit(e, close)}
          onKeyDown={(e) => {
            // Ctrl+Enter (Cmd+Enter on a Mac) saves from any field
            if (e.key === "Enter" && modPressed(e)) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          className="space-y-4"
        >
          {!entry && (
            <KindPicker kinds={KINDS} value={kind} onChange={setKind} />
          )}

          {kind !== "device" && kind !== "id" && titleRow}

          {/* A device starts from its sticker: scan it, then check what was read. */}
          {kind === "device" && <DeviceFields device={device} titleRow={titleRow} startScan={startScan} />}

          {kind === "id" && <IdFields idCard={idCard} titleRow={titleRow} />}
          {kind === "login" && <LoginFields login={login} entries={entries} url={url} onUrl={setUrl} />}
          {kind === "note" && <NoteFields note={note} />}
          {kind === "key" && <KeyFields apiKey={apiKey} url={url} onUrl={setUrl} />}
          {kind === "thing" && <ThingFields thing={thing} entries={entries} />}
          {kind === "link" && <LinkFields link={link} />}

          {kind !== "thing" && kind !== "id" && (
            <div>
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Logo</span>
              <LogoPicker value={brand} link={kind === "link" ? link.location : url} title={kind === "device" ? `${title} ${device.draft.model}` : title} onChange={setBrand} />
            </div>
          )}

          {kind !== "note" && (
            <Label text="Notes">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Label>
          )}
          <MoreOptions open={moreOpen} onOpen={() => setMoreOpen(true)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Kept for someone else (Mama, Lola): names already used come up as suggestions. */}
            <Label text="Held for">
              <TextInput value={heldFor} onChange={(e) => setHeldFor(e.target.value)} list={peopleId} placeholder="Lola" autoComplete="off" />
              <datalist id={peopleId}>
                {peopleHeldFor(entries).map((p) => (
                  <option key={p.name} value={p.name} />
                ))}
              </datalist>
            </Label>
            <Label text="Tags">
              <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="work, family" />
            </Label>
            {kind === "thing" && <ThingExpires thing={thing} />}
          </MoreOptions>

          <ErrorText message={error} />

          <div className="sticky -bottom-7 -mx-7 -mb-7 flex flex-wrap items-center gap-2 border-t border-line bg-raised px-7 py-4">
            {entry && (
              <Button type="button" variant="danger" onClick={() => remove(close)}>
                Move to Trash
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} title={`Save (${keys("mod", "Enter")})`}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
