import { vaultApi } from "@/lib/vault-api";
import { CopyButton } from "@/components/IconButton";
import { Expiry } from "@/components/Expiry";
import { Field } from "@/components/Card";
import type { GrabPriority, ThingEntry } from "@/features/vault/types";
import { grabLabel } from "../lib/things";

// Grab first is the one to notice; the other two stay quiet.
const GRAB_TONE: Record<GrabPriority, string> = { 1: "bg-accent-soft text-accent", 2: "bg-field text-ink-2", 3: "bg-field text-ink-3" };

function GrabBadge({ grab }: { grab: GrabPriority }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${GRAB_TONE[grab]}`}>{grabLabel(grab)}</span>;
}

export function ThingRows({ entry }: { entry: ThingEntry }) {
  return (
    <>
      <Field label="Room">{entry.room || <span className="text-ink-3">None</span>}</Field>
      <Field label="Where" actions={<CopyButton label="Copy spot" copy={() => vaultApi.copyText(entry.spot, entry.id)} toastText="Spot copied" />}>
        <span className="block whitespace-pre-wrap break-words py-1 text-[15px] leading-snug">{entry.spot}</span>
      </Field>
      <Field label="In a hurry">
        <GrabBadge grab={entry.grab} />
      </Field>
      {/* Most things never run out, so no expiry means no row (a key says Never). */}
      {entry.expires && (
        <Field label="Expires">
          <Expiry expires={entry.expires} />
        </Field>
      )}
    </>
  );
}
