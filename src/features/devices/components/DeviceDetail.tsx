import type { ReactNode } from "react";
import { Scan } from "@phosphor-icons/react";
import { vaultApi } from "@/lib/vault-api";
import { Card, Field } from "@/components/Card";
import { CopyButton } from "@/components/IconButton";
import { SecretField } from "@/components/SecretField";
import type { DeviceEntry } from "@/features/vault/types";
import { deviceTypeLabel, isBlankDevice } from "../lib/devices";
import { DEVICE_GLYPH } from "./DeviceIcon";

interface DeviceRowsProps {
  entry: DeviceEntry;
  openButton: () => ReactNode;
  copyLink: (location: string) => ReactNode;
}

// Only what the sticker had: a phone has no Wi-Fi rows, a router no IMEI.
export function DeviceRows({ entry, openButton, copyLink }: DeviceRowsProps) {
  const Glyph = Object.prototype.hasOwnProperty.call(DEVICE_GLYPH, entry.type) ? DEVICE_GLYPH[entry.type] : DEVICE_GLYPH.other;
  const plain = (label: string, value: string, toastText: string, mono = false) =>
    value && (
      <Field label={label} actions={<CopyButton copy={() => vaultApi.copyText(value, entry.id)} toastText={toastText} />}>
        <span className={mono ? "font-mono text-[13px] tracking-wide" : ""}>{value}</span>
      </Field>
    );
  // what: the secret named mid-sentence ("Copy admin password").
  const secret = (label: string, what: string, field: "wifiPassword" | "adminPassword") => (
    <SecretField label={label} reveal={() => vaultApi.getSecret(entry.id, field)} copy={() => vaultApi.copySecret(entry.id, field)} copyLabel={`Copy ${what} (clears in 30s)`} copiedToast={`${label} copied - clears in 30s`} />
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
      {entry.hasWifiPassword && secret("Wi-Fi password", "Wi-Fi password", "wifiPassword")}
      {entry.adminUrl && (
        <Field label="Admin page" actions={<>{openButton()}{copyLink(entry.adminUrl)}</>}>
          <span className="text-accent">{entry.adminUrl}</span>
        </Field>
      )}
      {plain("Admin username", entry.adminUser, "Username copied")}
      {entry.hasAdminPassword && secret("Admin password", "admin password", "adminPassword")}
      {plain("Model", entry.model, "Model copied")}
      {plain("Serial number", entry.serial, "Serial number copied", true)}
      {plain("IMEI", entry.imei, "IMEI copied", true)}
      {plain("MAC address", entry.mac, "MAC address copied", true)}
    </>
  );
}

// A device with nothing from its sticker yet: one way forward.
export function ScanPrompt({ entry, onScan }: { entry: DeviceEntry; onScan: () => void }) {
  if (!isBlankDevice(entry)) return null;
  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-7 text-center">
        <p className="text-[14px] text-ink-3">Nothing from the sticker yet</p>
        <button onClick={onScan} className="press mt-3.5 flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-on-accent shadow-accent hover:brightness-110 focus-ring">
          <Scan size={16} weight="bold" />
          Scan a label
        </button>
      </div>
    </Card>
  );
}
