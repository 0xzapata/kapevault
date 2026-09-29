import type { LabelFound } from "@/lib/vault-api";
import type { DeviceEntry, DeviceType } from "@/features/vault/types";
import { DEVICE_TYPES as TYPES } from "../../../../core/index.js";

// Sticker Capture: device types, which fields each one asks for first, and folding what a label
// scan found into the form. Pure, so it runs under `node --test`.

const LABELS: Record<DeviceType, string> = { router: "Router", cctv: "CCTV / NVR", phone: "Phone", laptop: "Laptop", other: "Other" };

// core's types, in its order, with the page's names.
export const DEVICE_TYPES: { value: DeviceType; label: string }[] = (TYPES as DeviceType[]).map((value) => ({ value, label: LABELS[value] }));

export const deviceTypeLabel = (type: DeviceType) => DEVICE_TYPES.find((t) => t.value === type)?.label ?? "Other";

// What to call it under a title or in a list: "Router", but "Device" rather than "Other".
export const deviceName = (type: DeviceType) => (type === "other" ? "Device" : deviceTypeLabel(type));

// A list row's second line: "Router · Archer C6", or the Wi-Fi name when there is no model.
export const deviceSubtitle = (e: DeviceEntry) => [deviceName(e.type), e.model || e.ssid].filter(Boolean).join(" · ");

export type DeviceField = "ssid" | "wifiPassword" | "adminUrl" | "adminUser" | "adminPassword" | "model" | "serial" | "imei" | "mac";

// Every field, in the order the form and the detail list them.
export const DEVICE_FIELDS: DeviceField[] = ["ssid", "wifiPassword", "adminUrl", "adminUser", "adminPassword", "model", "serial", "imei", "mac"];

export const SECRET_FIELDS: DeviceField[] = ["wifiPassword", "adminPassword"];

// What each type asks for up front; the rest wait under "More details". (A CCTV box's verification
// code goes in its notes, where a scan puts it.)
export const FIRST_FIELDS: Record<DeviceType, DeviceField[]> = {
  router: ["ssid", "wifiPassword", "adminUrl", "adminUser", "adminPassword"],
  cctv: ["adminUrl", "adminUser", "adminPassword", "serial"],
  phone: ["imei", "serial"],
  laptop: ["model", "serial"],
  other: ["model", "serial"],
};

export const FIELD_LABELS: Record<DeviceField, string> = {
  ssid: "Wi-Fi name",
  wifiPassword: "Wi-Fi password",
  adminUrl: "Admin page",
  adminUser: "Admin username",
  adminPassword: "Admin password",
  model: "Model",
  serial: "Serial number",
  imei: "IMEI",
  mac: "MAC address",
};

// The form's copy of a device (the label photo is its own slot, usePhotoSlot). A secret is null until the
// stored one has loaded.
export type DeviceDraft = { type: DeviceType } & Record<Exclude<DeviceField, "wifiPassword" | "adminPassword">, string> & {
    wifiPassword: string | null;
    adminPassword: string | null;
  };

export function draftFrom(entry: DeviceEntry | null): DeviceDraft {
  return {
    type: entry?.type ?? "router",
    model: entry?.model ?? "",
    serial: entry?.serial ?? "",
    imei: entry?.imei ?? "",
    mac: entry?.mac ?? "",
    adminUrl: entry?.adminUrl ?? "",
    adminUser: entry?.adminUser ?? "",
    ssid: entry?.ssid ?? "",
    adminPassword: entry?.hasAdminPassword ? null : "",
    wifiPassword: entry?.hasWifiPassword ? null : "",
  };
}

// A device with nothing from its label yet: the detail offers "Scan a label" instead of empty rows.
export const isBlankDevice = (e: DeviceEntry) =>
  !e.hasPhoto && !e.hasAdminPassword && !e.hasWifiPassword && [e.ssid, e.adminUrl, e.adminUser, e.model, e.serial, e.imei, e.mac].every((v) => !v);

// What a scan found goes only into empty fields - a value the user typed (or a stored secret still
// loading, null) is never replaced. The type follows the label.
export function applyFound(draft: DeviceDraft, found: LabelFound): DeviceDraft {
  const next = { ...draft, type: found.type ?? draft.type };
  for (const field of DEVICE_FIELDS) {
    const value = found[field];
    if (value && draft[field] === "") next[field] = value;
  }
  return next;
}

// How many details a scan read (the title it made up from them does not count).
export const foundCount = (found: LabelFound) => DEVICE_FIELDS.filter((f) => found[f]).length + (found.notes ? 1 : 0);
