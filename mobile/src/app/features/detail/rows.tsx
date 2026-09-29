import { ArrowSquareOut } from "@phosphor-icons/react";
import { CopyButton, Field, IconButton, SecretField, TotpValue } from "../../components/fields";
import { DEVICE_GLYPH, EntryIcon, SignInMark } from "../../components/icons";
import { useHost } from "../../host/host-context";
import { useTotp } from "../../hooks/use-totp";
import { providerBrand } from "../../lib/brands";
import { daysFromToday, formatDay, formatNumber, relativeDays } from "../../lib/format";
import { deviceTypeLabel, grabLabel, signInLabel } from "../../lib/entries";
import type { DeviceEntry, Entry, IdEntry, KeyEntry, LinkEntry, LoginEntry, NoteEntry, PayeeEntry, ThingEntry } from "../../host/types";

// The white card of rows under an item's header, one layout per kind (the PC's EntryDetail rows).

const none = (text = "None") => <span className="text-ink-3">{text}</span>;
const isLocalPath = (location: string) => /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(location);

function OpenButton({ id }: { id: string }) {
  const host = useHost();
  return (
    <IconButton label="Open" onClick={() => void host.openEntry(id)}>
      <ArrowSquareOut size={16} />
    </IconButton>
  );
}

function CopyText({ id, text, toast, label = "Copy" }: { id: string; text: string; toast: string; label?: string }) {
  const host = useHost();
  return <CopyButton label={label} copy={() => host.copyText(text, id)} toastText={toast} />;
}

function Secret({ entry, field, label, what }: { entry: Entry; field: "password" | "secret" | "wifiPassword" | "adminPassword" | "idNumber"; label: string; what: string }) {
  const host = useHost();
  return <SecretField label={label} what={what} reveal={() => host.getSecret(entry.id, field)} copy={() => host.copySecret(entry.id, field)} copiedToast={`${label} copied - clears in 30s`} />;
}

export function LoginRows({ entry, entries, onGoTo }: { entry: LoginEntry; entries: Entry[]; onGoTo: (id: string) => void }) {
  const host = useHost();
  const password = entry.signIn === "password";
  const account = entries.find((e) => e.id === entry.viaEntryId);
  return (
    <>
      {!password && (
        <Field label="Sign in with">
          <span className="flex items-center gap-2 font-medium">
            <SignInMark method={entry.signIn} size={18} />
            {signInLabel(entry.signIn)}
          </span>
        </Field>
      )}
      {!password && (
        <Field
          label="Account"
          actions={
            account && (
              <button type="button" onClick={() => onGoTo(account.id)} className="press hit mr-3 h-8 shrink-0 rounded-full bg-accent-soft px-3 text-[12.5px] font-semibold text-accent focus-ring">
                Go to account
              </button>
            )
          }
        >
          {account ? (
            <span className="flex items-center gap-2">
              <span className="-my-1 scale-[0.7]">
                <EntryIcon entry={account} size="sm" />
              </span>
              {account.title}
            </span>
          ) : (
            none("Not saved in KAPEVault")
          )}
        </Field>
      )}
      <Field label={password ? "Username" : "Email used"} actions={entry.username && <CopyText id={entry.id} text={entry.username} toast={password ? "Username copied" : "Email copied"} />}>
        {entry.username || none()}
      </Field>
      {entry.hasPassword ? <Secret entry={entry} field="password" label="Password" what="password" /> : password && <Field label="Password">{none("None saved")}</Field>}
      {entry.hasTotp && <TotpRow id={entry.id} />}
      <Field label="Website" actions={entry.url && <><OpenButton id={entry.id} /><CopyText id={entry.id} text={entry.url} toast="Link copied" /></>}>
        {entry.url ? <span className="text-accent">{entry.url}</span> : none()}
      </Field>
      {entry.questions.map((q, i) => (
        <SecretField key={`${q.question}-${i}`} label={q.question} what="answer" reveal={() => host.getSecret(entry.id, "answer", i)} copy={() => host.copySecret(entry.id, "answer", i)} copiedToast="Answer copied - clears in 30s" dots={8} />
      ))}
    </>
  );
}

function TotpRow({ id }: { id: string }) {
  const host = useHost();
  const { code, left } = useTotp(id);
  return (
    <Field label="2FA code" actions={<CopyButton label="Copy 2FA code" copy={() => host.copyTotp(id)} toastText="2FA code copied" />}>
      <TotpValue code={code} left={left} />
    </Field>
  );
}

function Expiry({ expires }: { expires?: string }) {
  const days = expires ? daysFromToday(expires) : null;
  if (!expires || days === null) return none("Never");
  const tone = days < 0 ? "text-danger" : days <= 30 ? "text-warn" : "";
  return (
    <span className={tone}>
      {formatDay(expires)} <span className={tone || "text-ink-3"}>({relativeDays(days)})</span>
    </span>
  );
}

export function KeyRows({ entry }: { entry: KeyEntry }) {
  return (
    <>
      <Field label="Key ID" actions={entry.keyId && <CopyText id={entry.id} text={entry.keyId} toast="Key ID copied" />}>
        {entry.keyId ? <span className="font-mono text-[13px]">{entry.keyId}</span> : none()}
      </Field>
      {entry.hasSecret ? <Secret entry={entry} field="secret" label="Secret" what="secret" /> : <Field label="Secret">{none("None saved")}</Field>}
      <Field label="Link" actions={entry.url && <><OpenButton id={entry.id} /><CopyText id={entry.id} text={entry.url} toast="Link copied" /></>}>
        {entry.url ? <span className="text-accent">{entry.url}</span> : none()}
      </Field>
      <Field label="Expires">
        <Expiry expires={entry.expires} />
      </Field>
    </>
  );
}

// The canvas's note row: masked until revealed, with its own copy.
export function NoteRow({ entry }: { entry: NoteEntry }) {
  const host = useHost();
  if (!entry.hasBody) return <Field label="Note">{none("Empty note")}</Field>;
  return <SecretField label="Note" what="note" reveal={() => host.getSecret(entry.id, "body")} copy={() => host.copySecret(entry.id, "body")} copiedToast="Note copied - clears in 30s" dots={18} />;
}

export function LinkRow({ entry }: { entry: LinkEntry }) {
  const local = isLocalPath(entry.location);
  return (
    <Field label="Location" actions={entry.location && <>{!local && <OpenButton id={entry.id} />}<CopyText id={entry.id} text={entry.location} toast={local ? "Path copied" : "Link copied"} /></>}>
      <span className={local ? "font-mono text-[13px]" : "text-accent"}>{entry.location}</span>
    </Field>
  );
}

export function PayeeRows({ entry }: { entry: PayeeEntry }) {
  const brand = providerBrand(entry.provider);
  return (
    <>
      <Field label="Who">
        {entry.who}
        {entry.relation && <span className="text-ink-3"> · {entry.relation}</span>}
      </Field>
      <Field label="Wallet or bank">
        <span className="flex items-center gap-2 font-medium">
          {brand && (
            <span className="grid size-6 shrink-0 place-items-center rounded-[6px] border border-line bg-paper">
              <img src={brand.logo} alt="" className="size-4 object-contain" />
            </span>
          )}
          {entry.provider}
        </span>
      </Field>
      <Field label="Number" actions={<CopyText id={entry.id} text={entry.number} toast="Number copied" label="Copy number" />}>
        <span className="font-mono text-[15px] tracking-wide">{formatNumber(entry.number)}</span>
      </Field>
      <Field label="Account name">{entry.accountName || none("Not saved")}</Field>
    </>
  );
}

const GRAB_TONE = { 1: "bg-accent-soft text-accent", 2: "bg-field text-ink-2", 3: "bg-field text-ink-3" };

export function ThingRows({ entry }: { entry: ThingEntry }) {
  return (
    <>
      <Field label="Room">{entry.room || none()}</Field>
      <Field label="Where" actions={<CopyText id={entry.id} text={entry.spot} toast="Spot copied" label="Copy spot" />}>
        <span className="block whitespace-pre-wrap break-words text-[15px] leading-snug">{entry.spot}</span>
      </Field>
      <Field label="In a hurry">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${GRAB_TONE[entry.grab]}`}>{grabLabel(entry.grab)}</span>
      </Field>
      {entry.expires && (
        <Field label="Expires">
          <Expiry expires={entry.expires} />
        </Field>
      )}
    </>
  );
}

// Only what the sticker had: a phone has no Wi-Fi rows, a router no IMEI.
export function DeviceRows({ entry }: { entry: DeviceEntry }) {
  const Glyph = Object.hasOwn(DEVICE_GLYPH, entry.type) ? DEVICE_GLYPH[entry.type] : DEVICE_GLYPH.other;
  const plain = (label: string, value: string, toast: string, mono = false) =>
    value && (
      <Field label={label} actions={<CopyText id={entry.id} text={value} toast={toast} />}>
        <span className={mono ? "font-mono text-[13px] tracking-wide" : ""}>{value}</span>
      </Field>
    );
  return (
    <>
      <Field label="Type">
        <span className="flex items-center gap-2 font-medium">
          <Glyph size={17} weight="fill" className="text-sys-cyan" />
          {deviceTypeLabel(entry.type)}
        </span>
      </Field>
      {plain("Wi-Fi name", entry.ssid, "Wi-Fi name copied")}
      {entry.hasWifiPassword && <Secret entry={entry} field="wifiPassword" label="Wi-Fi password" what="Wi-Fi password" />}
      {entry.adminUrl && (
        <Field label="Admin page" actions={<><OpenButton id={entry.id} /><CopyText id={entry.id} text={entry.adminUrl} toast="Link copied" /></>}>
          <span className="text-accent">{entry.adminUrl}</span>
        </Field>
      )}
      {plain("Admin username", entry.adminUser, "Username copied")}
      {entry.hasAdminPassword && <Secret entry={entry} field="adminPassword" label="Admin password" what="admin password" />}
      {plain("Model", entry.model, "Model copied")}
      {plain("Serial number", entry.serial, "Serial number copied", true)}
      {plain("IMEI", entry.imei, "IMEI copied", true)}
      {plain("MAC address", entry.mac, "MAC address copied", true)}
    </>
  );
}

export function IdRows({ entry }: { entry: IdEntry }) {
  return (
    <>
      <Field label="ID">
        <span className="font-medium">{entry.idType}</span>
      </Field>
      {entry.hasNumber ? <Secret entry={entry} field="idNumber" label="ID number" what="ID number" /> : <Field label="ID number">{none("None saved")}</Field>}
    </>
  );
}
