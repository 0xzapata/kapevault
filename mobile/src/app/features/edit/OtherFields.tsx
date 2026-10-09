import { useState } from "react";
import { Desktop } from "@phosphor-icons/react";
import { Label, Segmented, Select, TextArea, TextInput } from "../../components/form";
import { DEVICE_TYPES, GRAB, LINK_TYPES } from "../../lib/entries";
import { ProSheet } from "../pro/ProSheet";
import { ProTag } from "../pro/ProTag";
import { More, SecretInput } from "./inputs";
import { LogoField } from "./pickers";
import type { Draft, SetDraft } from "./use-item-form";
import type { DeviceType, Space } from "../../host/types";

type FieldsProps = { draft: Draft; set: SetDraft };
// locked: a client folder this item may not go to without KAPEVault Pro (ItemSheet asks host/pro.ts).
export type SpaceChoice = Space & { locked?: boolean };

export function TitleField({ draft, set, placeholder, label = "Title" }: FieldsProps & { placeholder: string; label?: string }) {
  return (
    <Label text={label}>
      <TextInput value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder={placeholder} autoComplete="off" />
    </Label>
  );
}

export function SpaceField({ draft, set, spaces }: FieldsProps & { spaces: SpaceChoice[] }) {
  const [showPro, setShowPro] = useState(false);
  return (
    <div>
      <Label text="Space">
        <Select value={draft.spaceId} onChange={(e) => set("spaceId", e.target.value)}>
          {spaces.map((s) => (
            <option key={s.id} value={s.id} disabled={s.locked}>
              {s.name}
            </option>
          ))}
        </Select>
      </Label>
      {spaces.some((s) => s.locked) && (
        <p className="mt-1.5 text-[12px] text-ink-3">
          Client folders are part of Pro <ProTag className="align-middle" />{" "}
          <button type="button" onClick={() => setShowPro(true)} className="press font-medium text-accent focus-ring">
            See Pro
          </button>
        </p>
      )}
      {showPro && <ProSheet onClose={() => setShowPro(false)} />}
    </div>
  );
}

export function ExpiresField({ draft, set }: FieldsProps) {
  return (
    <Label text="Expires (optional)">
      <TextInput type="date" value={draft.expires} onChange={(e) => set("expires", e.target.value)} />
    </Label>
  );
}

export function NoteFields({ draft, set }: FieldsProps) {
  return (
    <>
      <Label text="Note">
        <TextArea value={draft.body ?? ""} placeholder={draft.body === null ? "Loading..." : "PINs, door codes, anything private"} onChange={(e) => set("body", e.target.value)} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="none" className="h-40 leading-relaxed" />
      </Label>
      <LogoField draft={draft} set={set} />
    </>
  );
}

export function KeyFields({ draft, set }: FieldsProps) {
  return (
    <>
      <Label text="Key ID">
        <TextInput value={draft.keyId} onChange={(e) => set("keyId", e.target.value)} placeholder="Client ID or access key ID" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="none" className="font-mono" />
      </Label>
      <SecretInput label="Secret" value={draft.secret} onChange={(v) => set("secret", v)} />
      <Label text="Link">
        <TextInput value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="dash.cloudflare.com" inputMode="url" autoCapitalize="none" />
      </Label>
      <ExpiresField draft={draft} set={set} />
      <LogoField draft={draft} set={set} />
    </>
  );
}

export function LinkFields({ draft, set }: FieldsProps) {
  return (
    <>
      <Label text="Type">
        <Select value={draft.linkType} onChange={(e) => set("linkType", e.target.value as Draft["linkType"])}>
          {LINK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Label>
      <Label text="Location">
        <TextInput value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="https://drive.google.com/..." inputMode="url" autoCapitalize="none" />
      </Label>
      <LogoField draft={draft} set={set} />
    </>
  );
}

export function ThingFields({ draft, set }: FieldsProps) {
  return (
    <>
      <Label text="Room (optional)">
        <TextInput value={draft.room} onChange={(e) => set("room", e.target.value)} placeholder="Bedroom" />
      </Label>
      <Label text="Where exactly">
        <TextInput value={draft.spot} onChange={(e) => set("spot", e.target.value)} placeholder="Blue folder, top shelf of the cabinet" />
      </Label>
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">In a hurry</span>
        <Segmented label="In a hurry" options={GRAB} value={draft.grab} onChange={(v) => set("grab", v)} />
      </div>
    </>
  );
}

type DeviceField = "ssid" | "wifiPassword" | "adminUrl" | "adminUser" | "adminPassword" | "model" | "serial" | "imei" | "mac";
const ALL: DeviceField[] = ["ssid", "wifiPassword", "adminUrl", "adminUser", "adminPassword", "model", "serial", "imei", "mac"];
// What each type asks for up front; the rest wait under More details (the PC's FIRST_FIELDS).
const FIRST: Record<DeviceType, DeviceField[]> = {
  router: ["ssid", "wifiPassword", "adminUrl", "adminUser", "adminPassword"],
  cctv: ["adminUrl", "adminUser", "adminPassword", "serial"],
  phone: ["imei", "serial"],
  laptop: ["model", "serial"],
  other: ["model", "serial"],
};
const LABELS: Record<DeviceField, string> = { ssid: "Wi-Fi name", wifiPassword: "Wi-Fi password", adminUrl: "Admin page", adminUser: "Admin username", adminPassword: "Admin password", model: "Model", serial: "Serial number", imei: "IMEI", mac: "MAC address" };

export function DeviceTypeField({ draft, set }: FieldsProps) {
  return (
    <div>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Type</span>
      <Segmented label="Type" options={DEVICE_TYPES} value={draft.type} onChange={(v) => set("type", v)} />
    </div>
  );
}

export function DeviceFields({ draft, set }: FieldsProps) {
  const first = FIRST[draft.type];
  const rest = ALL.filter((f) => !first.includes(f));
  const [more, setMore] = useState(() => rest.some((f) => Boolean(draft[f])));
  const field = (f: DeviceField) =>
    f === "wifiPassword" || f === "adminPassword" ? (
      <SecretInput key={f} label={LABELS[f]} value={draft[f]} onChange={(v) => set(f, v)} />
    ) : (
      <Label key={f} text={LABELS[f]}>
        <TextInput value={draft[f]} onChange={(e) => set(f, e.target.value)} placeholder={f === "adminUrl" ? "192.168.1.1" : undefined} autoCapitalize="none" autoComplete="off" className={f === "serial" || f === "imei" || f === "mac" ? "font-mono" : ""} />
      </Label>
    );
  return (
    <>
      {first.map(field)}
      <More open={more} onOpen={() => setMore(true)} label="More details">
        {rest.map(field)}
      </More>
      <p className="flex items-center gap-2 text-[12.5px] text-ink-3">
        <Desktop size={16} />
        Scan a label is on your PC.
      </p>
      <LogoField draft={draft} set={set} />
    </>
  );
}
