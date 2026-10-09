import { useState } from "react";
import { Camera } from "@phosphor-icons/react";
import { Button, ErrorText, Label, TextInput } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";
import { useVault } from "../../hooks/use-vault";
import { dayAndTime } from "../../lib/format";
import type { Backup, R2Keys } from "../../host/types";
import { bucketOf } from "../cloud/lib/bucket";
import { useSetupScan } from "../cloud/use-setup-scan";
import { BucketFacts } from "./BucketFacts";

type Choice = "use" | "keep";

// Settings > Backup and sync > Connect to R2 (R2 is optional). The PC's "Add a phone" code, or
// the three values typed. A bucket that holds another vault asks which vault this phone keeps.
export function ConnectSheet({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const host = useHost();
  const toast = useToast();
  const view = useVault();
  const [keys, setKeys] = useState<R2Keys>({ url: "", accessKeyId: "", secretAccessKey: "" });
  const [other, setOther] = useState<Backup | null>(null);
  const [choice, setChoice] = useState<Choice>("use");
  const [master, setMaster] = useState("");
  const [confirming, setConfirming] = useState(false); // the last look before this phone's items are copied into that vault
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { scanned, setScanned, scan } = useSetupScan(setError);

  const where = other?.device === "PC" ? "your PC" : (other?.device ?? "");
  const done = (close: () => void, message: string) => {
    toast(message);
    onConnected();
    close();
  };

  async function connect(close: () => void, r2 = keys) {
    setBusy(true);
    setError("");
    const result = await host.connectCloud(r2);
    setBusy(false);
    setScanned(null);
    if (!result.ok) return setError(result.error);
    setKeys(r2);
    if (result.other) return setOther(result.other);
    done(close, "Connected. This vault now backs up to R2.");
  }

  function scanCode(close: () => void) {
    setError("");
    void scan((r2) => connect(close, r2));
  }

  async function decide(close: () => void) {
    setBusy(true);
    setError("");
    if (choice === "keep") {
      const result = await host.keepThisVault(keys);
      setBusy(false);
      if (!result.ok) return setError(result.error);
      return done(close, "Connected. This phone's vault backs up, without sync.");
    }
    const result = await host.useCloudVault(keys, (other as Backup).key, master);
    setBusy(false);
    setMaster("");
    setConfirming(false); // a refusal (wrong password) lands back on the form
    if (!result.ok) return setError(result.error);
    done(close, result.carried ? `Using the vault from ${where}. ${result.carried} ${result.carried === 1 ? "item" : "items"} from this phone were added to it.` : `Using the vault from ${where}.`);
  }

  const count = view?.entries.length ?? 0;
  const place = bucketOf(keys.url);
  const items = `${count} ${count === 1 ? "item" : "items"}`;
  const field = (label: string, key: keyof R2Keys, mono = false) => (
    <Label text={label}>
      <TextInput value={keys[key]} onChange={(e) => setKeys({ ...keys, [key]: e.target.value })} type={key === "secretAccessKey" ? "password" : "text"} autoComplete="off" autoCapitalize="none" spellCheck={false} className={mono ? "font-mono" : ""} />
    </Label>
  );
  const option = (value: Choice, title: string, text: string) => (
    // biome-ignore lint/a11y/useSemanticElements: a radio drawn as a button row; a native radio input cannot be styled as this control
    <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)} className="press flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 focus-ring">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${choice === value ? "border-accent" : "border-line-strong"}`}>{choice === value && <span className="swap-in size-2.5 rounded-full bg-accent" />}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[12.5px] leading-relaxed text-ink-3">{text}</span>
      </span>
    </button>
  );

  return (
    <Sheet
      title={confirming ? "Copy your items there?" : other ? "This bucket holds another vault" : scanned ? "Connect to this bucket?" : "Connect to R2"}
      tall={!other && !scanned}
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="flex-1" />
          <Button onClick={scanned && !busy ? () => setScanned(null) : confirming && !busy ? () => setConfirming(false) : close}>{confirming ? "Back" : "Cancel"}</Button>
          {scanned ? (
            <Button variant="primary" disabled={busy} onClick={() => connect(close, scanned.keys)}>
              {busy ? "Connecting..." : "Connect"}
            </Button>
          ) : confirming ? (
            <Button variant="danger" disabled={busy} onClick={() => decide(close)}>
              {busy ? "Working..." : `Copy ${items} and continue`}
            </Button>
          ) : other ? (
            <Button variant="primary" disabled={busy || (choice === "use" && !master)} onClick={() => (choice === "use" && count > 0 ? setConfirming(true) : decide(close))}>
              {busy ? "Working..." : choice === "use" ? "Use that vault" : "Keep this vault"}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || !keys.url || !keys.accessKeyId || !keys.secretAccessKey} onClick={() => connect(close)}>
              {busy ? "Connecting..." : "Connect"}
            </Button>
          )}
        </>
      )}
    >
      {(close) =>
        scanned ? (
          <div key="scanned" className="settle mt-3 flex flex-col gap-4">
            <BucketFacts account={scanned.account} bucket={scanned.bucket} />
            <p className="text-[12.5px] leading-relaxed text-ink-3">Backups go to this bucket. Connect only if it is yours.</p>
            <ErrorText message={error} />
          </div>
        ) : confirming ? (
          <div key="confirm" className="settle mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-ink-2">
              This phone's {items} will be copied into the vault from {where}, then uploaded to this bucket, encrypted with that vault's password.
            </p>
            {place ? <BucketFacts account={place.account} bucket={place.bucket} /> : <p className="font-mono text-[13px] break-all text-ink">{keys.url}</p>}
            <p className="text-[13px] font-medium leading-relaxed text-danger">Only continue if you set up this bucket yourself. Never do this because someone asked you to.</p>
            <ErrorText message={error} />
          </div>
        ) : other ? (
          // The question replaces the keys form: it settles in rather than swapping in one frame.
          <div key="other" className="settle mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-ink-2">
              Its newest backup is the vault from {where} ({dayAndTime(other.at)}). It is not this phone's vault, so the two cannot sync as they are.
            </p>
            <div role="radiogroup" aria-label="Which vault" className="overflow-hidden rounded-2xl border border-line">
              {option("use", `Use the vault from ${where}`, `This phone's ${items} ${count === 1 ? "is" : "are"} copied into it as new ${count === 1 ? "item" : "items"}, so nothing you added here is lost. They are then uploaded to ${place ? `${place.account} / ${place.bucket}` : "that bucket"}. This phone's vault is kept on the phone as a copy.`)}
              {option("keep", "Keep this phone's vault", `It backs up to the bucket, but does not sync with ${where}.`)}
            </div>
            {choice === "use" && (
              <Label text={`Master password of the vault from ${where}`}>
                <TextInput type="password" value={master} onChange={(e) => setMaster(e.target.value)} autoComplete="off" autoFocus />
              </Label>
            )}
            <ErrorText message={error} />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-[12.5px] leading-relaxed text-ink-3">Back up this vault to your own Cloudflare R2 bucket. With Pro, it also syncs with your PC. Only the encrypted file is uploaded. On your PC: Settings &gt; Backup &gt; Add a phone.</p>
            <Button variant="primary" onClick={() => scanCode(close)} disabled={busy} className="self-start">
              <Camera size={16} />
              Scan the code
            </Button>
            <p className="text-[12.5px] font-medium text-ink-2">Or type the keys</p>
            {field("S3 API URL", "url")}
            {field("Access key ID", "accessKeyId", true)}
            {field("Secret access key", "secretAccessKey", true)}
            <ErrorText message={error} />
          </div>
        )
      }
    </Sheet>
  );
}
