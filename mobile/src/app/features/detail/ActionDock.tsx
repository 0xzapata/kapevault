import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import { useCopyAction } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { useTotp } from "../../hooks/use-totp";
import { groupCode } from "../../lib/format";
import { linkOf } from "../../lib/entries";
import type { Entry, VaultHost } from "../../host/types";

interface CopyAction {
  label: string;
  copy: () => Promise<unknown>;
  toast: string;
  totp?: boolean; // shows the live code on the button
}

// The one or two things you open an item to do (the PC's QuickActions).
function copiesFor(entry: Entry, host: VaultHost): CopyAction[] {
  const id = entry.id;
  const list: CopyAction[] = [];
  if (entry.kind === "login" && entry.hasPassword) list.push({ label: "Copy password", copy: () => host.copySecret(id, "password"), toast: "Password copied - clears in 30s" });
  if (entry.kind === "login" && entry.hasTotp) list.push({ label: "Copy code", copy: () => host.copyTotp(id), toast: "2FA code copied", totp: true });
  if (entry.kind === "key" && entry.hasSecret) list.push({ label: "Copy secret", copy: () => host.copySecret(id, "secret"), toast: "Secret copied - clears in 30s" });
  if (entry.kind === "note" && entry.hasBody) list.push({ label: "Copy note", copy: () => host.copySecret(id, "body"), toast: "Note copied - clears in 30s" });
  if (entry.kind === "payee") list.push({ label: "Copy number", copy: () => host.copyText(entry.number, id), toast: "Number copied" });
  if (entry.kind === "thing") list.push({ label: "Copy spot", copy: () => host.copyText(entry.spot, id), toast: "Spot copied" });
  if (entry.kind === "device" && entry.hasWifiPassword) list.push({ label: "Copy Wi-Fi password", copy: () => host.copySecret(id, "wifiPassword"), toast: "Wi-Fi password copied - clears in 30s" });
  if (entry.kind === "id" && entry.hasNumber) list.push({ label: "Copy ID number", copy: () => host.copySecret(id, "idNumber"), toast: "ID number copied - clears in 30s" });
  if (entry.kind === "device" && entry.imei) list.push({ label: "Copy IMEI", copy: () => host.copyText(entry.imei, id), toast: "IMEI copied" });
  return list;
}

function openLabel(entry: Entry) {
  if (entry.kind === "login") return "Open website";
  if (entry.kind === "device") return "Open admin page";
  return "Open link";
}

const dock = "press flex h-11 min-w-0 items-center justify-center gap-2 rounded-full px-1 text-[13.5px] font-semibold focus-ring";

// The PC's pills moved into a dock at the bottom, under the thumb. The first copy is
// primary and full width; the next copy and Open share the row under it.
export function ActionDock({ entry }: { entry: Entry }) {
  const host = useHost();
  const copies = copiesFor(entry, host).slice(0, 2);
  const link = linkOf(entry) && !(entry.kind === "link" && entry.linkType === "folder") ? linkOf(entry) : "";
  if (copies.length === 0 && !link) return null;
  const [first, second] = copies;
  return (
    <div data-bottom-chrome className="bottom-bar z-10 flex shrink-0 flex-col gap-2 px-4 pb-[calc(var(--sab)+10px)] pt-2.5">
      {first && <CopyDockButton action={first} entryId={entry.id} primary />}
      {(second || link) && (
        <div className="flex gap-2">
          {second && <CopyDockButton action={second} entryId={entry.id} />}
          {link && (
            <button type="button" onClick={() => void host.openEntry(entry.id)} className={`${dock} flex-1 bg-raised text-accent shadow-tile`}>
              <ArrowSquareOut size={15} weight="bold" className="shrink-0" />
              <span className="truncate">{openLabel(entry)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CopyDockButton({ action, entryId, primary = false }: { action: CopyAction; entryId: string; primary?: boolean }) {
  const { copied, run } = useCopyAction();
  const { code } = useTotp(action.totp ? entryId : null);
  return (
    <button type="button" onClick={() => run(action.copy, action.toast)} className={`${dock} ${primary ? "w-full bg-accent text-on-accent shadow-accent" : "flex-1 bg-raised text-accent shadow-tile"}`}>
      {copied ? <Check size={15} weight="bold" className="swap-in shrink-0" /> : <Copy size={15} weight="bold" className="shrink-0" />}
      <span className="truncate">
        {copied ? "Copied" : action.label}
        {!copied && code && (
          <b key={code.code} className="settle ml-1 inline-block font-semibold tracking-[0.06em] tabular-nums">
            {groupCode(code.code)}
          </b>
        )}
      </span>
    </button>
  );
}
