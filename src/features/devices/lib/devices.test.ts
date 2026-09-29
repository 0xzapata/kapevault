// Run with `npm test` (Node strips the types). Sticker Capture: type fields and scan results.
import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_FIELDS, DEVICE_TYPES, FIRST_FIELDS, applyFound, draftFrom, foundCount, isBlankDevice } from "./devices.ts";
import type { DeviceEntry } from "@/features/vault/types";

const device = (fields: Partial<DeviceEntry> = {}) =>
  ({ id: "d", kind: "device", title: "Mock Router", type: "router", model: "", serial: "", imei: "", mac: "", adminUrl: "", adminUser: "", ssid: "", hasAdminPassword: false, hasWifiPassword: false, hasPhoto: false, spaceId: "s", tags: [], favorite: false, notes: "", updatedAt: "2026-09-26", issues: [], ...fields }) as DeviceEntry;

test("every device type has a name to show", () => {
  for (const { value, label } of DEVICE_TYPES) assert.ok(typeof label === "string" && label.length > 0, value);
});

test("every type asks for its own fields first, all of them real fields", () => {
  for (const { value } of DEVICE_TYPES) assert.ok(FIRST_FIELDS[value].length > 0 && FIRST_FIELDS[value].every((f) => DEVICE_FIELDS.includes(f)), value);
  assert.deepEqual(FIRST_FIELDS.router, ["ssid", "wifiPassword", "adminUrl", "adminUser", "adminPassword"]);
  assert.deepEqual(FIRST_FIELDS.phone, ["imei", "serial"]);
});

test("a scan fills only empty fields and never a stored secret still loading; the type follows the label", () => {
  const draft = { ...draftFrom(device({ hasWifiPassword: true })), ssid: "Typed_Name" };
  assert.equal(draft.wifiPassword, null, "a stored secret starts unloaded");
  const next = applyFound(draft, { type: "cctv", ssid: "Scanned_Name", wifiPassword: "scanned", adminUser: "admin", serial: "MOCK1" });
  assert.equal(next.ssid, "Typed_Name");
  assert.equal(next.wifiPassword, null);
  assert.equal(next.adminUser, "admin");
  assert.equal(next.serial, "MOCK1");
  assert.equal(next.type, "cctv");
  assert.deepEqual(applyFound(draft, {}), draft, "nothing found, nothing changes");
  assert.equal(foundCount({ type: "router", title: "Mock", ssid: "x", mac: "y", notes: "Verification code: Z" }), 3, "the title and type are not details");
});

test("a device with nothing from its label yet is blank; one field or the photo is enough", () => {
  assert.equal(isBlankDevice(device()), true);
  assert.equal(isBlankDevice(device({ ssid: "Mock" })), false);
  assert.equal(isBlankDevice(device({ hasPhoto: true })), false);
  assert.equal(isBlankDevice(device({ hasWifiPassword: true })), false);
});
