// The "modal" scenario: one Sheet holding every kind of control Tab may or may not reach, for the
// shared focus helpers (src/lib/focus.ts) and useModal. run.mjs drives it.
import { useRef, useState } from "react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Menu, useMenu } from "@/components/Menu";
import { Sheet } from "@/components/Sheet";
import { tabStops } from "@/lib/focus";
import { PhotoViewer } from "@/components/photo";

// 0.1s of silence: an audio element with a real source draws its full controls.
const WAV = `data:audio/wav;base64,${btoa("RIFF" + "\x44\x03\x00\x00" + "WAVEfmt " + "\x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x40\x1f\x00\x00\x01\x00\x08\x00" + "data" + "\x20\x03\x00\x00" + "\x80".repeat(800))}`;

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

(window as any).__tabStops = () => tabStops(document.querySelector<HTMLElement>("[role=dialog]")!).map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim());

// The "return" scenario: sheets whose opener is gone by the time they close - a menu item, an Edit
// button remounted by the save, a button removed with its item.
export function ReturnFixture() {
  const menu = useMenu();
  const actions = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<"menu" | "edit" | null>(null);
  const [revision, setRevision] = useState(0);
  const [removed, setRemoved] = useState(false);
  return (
    <div style={{ height: "100dvh", background: "white" }}>
      <button ref={actions} onClick={() => actions.current && menu.openUnder(actions.current)}>
        Actions
      </button>
      <ul data-focus-home tabIndex={0} aria-label="Home list">
        <li>Row</li>
      </ul>
      {/* A delete that did not happen (the main process refused): the row stays */}
      <ConfirmDelete onConfirm={async () => {}} />
      {/* A kept copy: the confirm asks for its own password; main refuses a wrong one, so the row stays */}
      <ConfirmDelete
        label="Delete copy"
        password={{ label: "Its master password", note: "Mock note" }}
        onConfirm={async (password) => {
          (window as any).__tried = [...((window as any).__tried ?? []), password];
        }}
      />
      {!removed && (
        <button key={revision} data-focus-key="edit" onClick={() => setSheet("edit")}>
          Edit
        </button>
      )}
      {menu.anchor && <Menu label="Actions" anchor={menu.anchor} onClose={menu.close} items={[{ label: "Open sheet", onSelect: () => setSheet("menu") }]} />}
      {sheet && (
        <Sheet title="Return" onClose={() => setSheet(null)}>
          {(close) => (
            <>
              <button
                onClick={() => {
                  setRevision((r) => r + 1);
                  close();
                }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setRemoved(true);
                  close();
                }}
              >
                Remove
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

export function ModalFixture() {
  const [open, setOpen] = useState(true);
  const [late, setLate] = useState(false); // a sibling that mounts while the sheet is open (the sidebar at 900px)
  const [second, setSecond] = useState(false); // a sheet opened over this one (Settings -> Shortcuts)
  const [photo, setPhoto] = useState(false); // the label photo: a modal portaled to body
  Object.assign(window, { __showLate: () => setLate(true), __openSecond: () => setSecond(true), __openPhoto: () => setPhoto(true) });
  return (
    <div style={{ height: "100dvh", background: "white" }}>
      <button data-behind>Behind</button>
      {late && <button data-late>Late</button>}
      {photo && <PhotoViewer photo={PIXEL} label="Label photo" onClose={() => setPhoto(false)} />}
      {second && (
        <Sheet title="Second" onClose={() => setSecond(false)}>
          <button>Second button</button>
        </Sheet>
      )}
      {open && (
        <Sheet title="Fixture" onClose={() => setOpen(false)}>
          <div className="space-y-2">
            <button>First</button>
            <button disabled>Disabled</button>
            <button hidden>Hidden</button>
            <button style={{ visibility: "hidden" }}>Invisible</button>
            <div inert>
              <button>Inert</button>
            </div>
            <button tabIndex={-1}>Out of order</button>
            <input type="hidden" />
            <a href="#x">Link</a>
            <a>Not a link</a>
            <div tabIndex={0}>Zero</div>
            <div contentEditable suppressContentEditableWarning>
              Editable
            </div>
            <details>
              <summary>More</summary>
              <button>Folded</button>
            </details>
            <input type="radio" name="r" aria-label="Radio one" defaultChecked />
            <input type="radio" name="r" aria-label="Radio two" />
            <iframe title="Frame" aria-label="Frame" srcDoc="<button>Inside</button>" className="h-12" />
            <audio controls aria-label="Audio" src={WAV} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
