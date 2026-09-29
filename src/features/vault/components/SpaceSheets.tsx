import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText, Label, Select } from "@/components/form";
import { plural } from "@/lib/local-date";
import { ipcMessage } from "@/lib/ipc-message";
import type { Entry, Space } from "../types";

// Deleting a client: its items move to another space by default. Deleting them too takes a
// second, explicit click that names how many items go.
export function DeleteClientSheet({ space, spaces, itemCount, onDelete, onClose }: {
  space: Space;
  spaces: Space[];
  itemCount: number;
  onDelete: (moveToId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const others = spaces.filter((s) => s.id !== space.id);
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [moveTo, setMoveTo] = useState(others.find((s) => s.kind === "personal")?.id ?? others[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = plural(itemCount, "item");

  async function submit(close: () => void) {
    if (itemCount > 0 && mode === "delete" && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await onDelete(itemCount > 0 && mode === "move" ? moveTo : null);
      close();
    } catch (e) {
      setError(ipcMessage(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Delete ${space.name}?`} onClose={onClose} width="w-[460px]">
      {(close) => (
        <div className="space-y-4">
          {itemCount === 0 ? (
            <p className="text-[13.5px] text-ink-2">This client has no items. Deleting it only removes the name.</p>
          ) : (
            <>
              <p className="text-[13.5px] text-ink-2">This client holds {items}. Choose what happens to them.</p>
              <div role="radiogroup" aria-label="What happens to the items" className="space-y-2">
                {(["move", "delete"] as const).map((m) => (
                  <label key={m} className={`row flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 ${mode === m ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"}`}>
                    <input
                      type="radio"
                      name="delete-mode"
                      checked={mode === m}
                      onChange={() => {
                        setMode(m);
                        setConfirming(false);
                      }}
                      className="mt-0.5 accent-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">{m === "move" ? "Move the items to another space" : `Delete the ${items} too`}</span>
                      <span className="block text-[12.5px] text-ink-3">{m === "move" ? "Nothing is lost; only the client name goes." : "They are gone from this vault. Older cloud backups still hold them."}</span>
                    </span>
                  </label>
                ))}
              </div>
              {mode === "move" && (
                <Label text="Move to">
                  <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Label>
              )}
            </>
          )}
          <ErrorText message={error} />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => submit(close)}>
              {confirming ? `Delete client and ${items}` : "Delete client"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// "Move to..." from an item's menu - the keyboard/menu twin of dragging it onto a space.
export function MoveEntrySheet({ entry, spaces, onMove, onClose }: {
  entry: Entry;
  spaces: Space[];
  onMove: (spaceId: string) => Promise<void>;
  onClose: () => void;
}) {
  const others = spaces.filter((s) => s.id !== entry.spaceId);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [error, setError] = useState("");

  return (
    <Sheet title={`Move ${entry.title}`} onClose={onClose} width="w-[420px]">
      {(close) => (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onMove(target);
              close();
            } catch (err) {
              setError(ipcMessage(err));
            }
          }}
        >
          <Label text="Move to">
            <Select autoFocus value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Label>
          <ErrorText message={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!target}>
              Move
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
