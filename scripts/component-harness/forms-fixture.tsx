// The "forms" and "move" scenarios: every form the harness can mount, each counting how many times it
// submitted (window.__submits). run.mjs presses Enter in each and clicks every non-submit button in it.
import { Button } from "@/components/form";
import { CredentialsForm } from "@/features/cloud/components/CredentialsForm";
import { LockScreen } from "@/features/lock/LockScreen";
import { QuickUnlock } from "@/features/quick/components/QuickUnlock";
import { ChangeMasterForm } from "@/features/settings/ChangeMasterForm";
import { NewMasterCard } from "@/features/sync/components/NewMasterCard";
import { MoveEntrySheet } from "@/features/vault/components/SpaceSheets";
import type { Entry } from "@/features/vault/types";

const submits: Record<string, number> = {};
(window as any).__submits = submits;
const count = (name: string) => {
  submits[name] = (submits[name] ?? 0) + 1;
};

export function FormsFixture() {
  return (
    <div style={{ background: "white" }}>
      <section aria-label="Credentials">
        <CredentialsForm submitLabel="Connect" busyLabel="Connecting..." busy={false} error="" onSubmit={() => count("credentials")} />
      </section>
      <section aria-label="Change master">
        <ChangeMasterForm />
      </section>
      <section aria-label="New master">
        <NewMasterCard device="Mock laptop" onAdopt={async () => {
          count("newMaster");
          return "";
        }} />
      </section>
      {/* Button called the way a caller that forgot a type calls it: it must still not submit the form. */}
      <section aria-label="Plain buttons">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            count("plain");
          }}
        >
          <input aria-label="Mock field" />
          <Button>Plain</Button>
          <Button variant="danger">Danger</Button>
          <button type="submit">Send</button>
        </form>
      </section>
      <section aria-label="Quick unlock" style={{ width: 360, height: 220 }}>
        <QuickUnlock shown={0} onOpen={() => {}} />
      </section>
      <section aria-label="Lock screen" style={{ width: 800, height: 700 }}>
        <LockScreen isNew={false} onOpen={() => {}} />
      </section>
    </div>
  );
}

const entry = { id: "e1", kind: "note", title: "Mock note", spaceId: "p", tags: [], favorite: false, notes: "", updatedAt: "2026-09-25", issues: [] } as unknown as Entry;

export function MoveFixture() {
  return (
    <MoveEntrySheet
      entry={entry}
      spaces={[
        { id: "p", name: "Personal", kind: "personal" },
        { id: "c", name: "Mock client", kind: "client" },
      ]}
      onMove={async () => count("move")}
      onClose={() => {}}
    />
  );
}
