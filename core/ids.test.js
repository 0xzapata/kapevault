import test from "node:test";
import assert from "node:assert/strict";
import { ID_TYPES, cleanIdNumber, cleanIdType } from "./ids.js";
import { upsertEntry } from "./entries.js";
import { publicView, secretOf } from "./public-view.js";
import { importEntries } from "./import.js";
import { groupOf } from "./sync/groups.js";
import { SECRET_GROUPS } from "./sync/merge.js";
import { MAX_PHOTOS_BYTES } from "./devices.js";

const JPEG = `data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0 mock jpeg")}`;
const vault = () => ({ spaces: [{ id: "s", name: "Personal", kind: "personal" }], entries: [] });

test("ID types: Philippine ones first, no Other (any other name is stored as typed)", () => {
  assert.equal(ID_TYPES[0], "Passport");
  assert.ok(ID_TYPES.includes("National ID (PhilSys)"));
  assert.ok(!ID_TYPES.includes("Other"));
  assert.equal(cleanIdType("  Barangay ID "), "Barangay ID");
  assert.throws(() => cleanIdType(" "), /Say which ID/);
  assert.throws(() => cleanIdType("x".repeat(61)), /too long/);
  assert.equal(cleanIdNumber(" 34-1234567-8 "), "34-1234567-8");
  assert.equal(cleanIdNumber(""), undefined);
  assert.throws(() => cleanIdNumber("1".repeat(65)), /up to 64/);
});

test("an ID keeps its number and photo as secrets: the page sees only flags", () => {
  const data = vault();
  const id = upsertEntry(data, { kind: "id", spaceId: "s", title: "Passport", idType: "Passport", idNumber: " P1234567A ", photo: JPEG, brand: "github" });
  const stored = data.entries[0];
  assert.equal(stored.idNumber, "P1234567A");
  assert.equal(stored.brand, undefined);
  const [seen] = publicView(data, new Map()).entries;
  assert.deepEqual(Object.keys(seen).filter((k) => !["id", "kind", "spaceId", "title", "tags", "favorite", "notes", "updatedAt", "lastUsedAt", "brand", "heldFor", "issues"].includes(k)).sort(), ["hasNumber", "hasPhoto", "idType"]);
  assert.equal(seen.hasNumber, true);
  assert.equal(seen.hasPhoto, true);
  assert.equal(JSON.stringify(seen).includes("P1234567A"), false);
  assert.equal(secretOf(stored, "idNumber"), "P1234567A");
  assert.equal(secretOf(stored, "photo"), JPEG);
  assert.equal(secretOf(stored, "password"), "");

  // An edit that leaves the secrets out keeps them; "" clears them.
  upsertEntry(data, { id, kind: "id", spaceId: "s", title: "My passport", idType: "Passport" });
  assert.equal(data.entries[0].idNumber, "P1234567A");
  assert.equal(data.entries[0].photo, JPEG);
  upsertEntry(data, { id, kind: "id", spaceId: "s", title: "My passport", idType: "Passport", idNumber: "", photo: "" });
  assert.equal(data.entries[0].idNumber, undefined);
  assert.equal(data.entries[0].photo, undefined);
  assert.equal(publicView(data, new Map()).entries[0].hasNumber, false);
});

test("an ID's photo is checked like a label photo and shares the one photo cap", () => {
  const data = vault();
  assert.throws(() => upsertEntry(data, { kind: "id", spaceId: "s", title: "UMID", idType: "UMID", photo: "data:image/png;base64,iVBORw0KGgo=" }), /Photo could not be saved/);
  assert.throws(() => upsertEntry(data, { kind: "id", spaceId: "s", title: "UMID" }), /Say which ID/);
  data.entries = [{ id: "d", kind: "device", spaceId: "s", title: "Router", type: "router", photo: "x".repeat(MAX_PHOTOS_BYTES) }];
  assert.throws(() => upsertEntry(data, { kind: "id", spaceId: "s", title: "UMID", idType: "UMID", photo: JPEG }), /no room for more photos/);
});

test("an import takes IDs and refuses a bad one whole", () => {
  const data = vault();
  const result = importEntries(data, [{ kind: "id", title: "Mock TIN", idType: "TIN", idNumber: "123-456-789-000" }]);
  assert.deepEqual(result, { added: 1, skipped: 0 });
  assert.equal(data.entries[0].idNumber, "123-456-789-000");
  assert.throws(() => importEntries(data, [{ kind: "id", title: "No type" }]), /Item 1: Say which ID it is/);
  assert.throws(() => importEntries(data, [{ kind: "id", title: "Bad", idType: "SSS", idNumber: 12345 }]), /idNumber must be text/);
  assert.equal(data.entries.length, 1);
});

test("an imported ID with no title is named after its type, as the form does", () => {
  const data = vault();
  assert.deepEqual(importEntries(data, [{ kind: "id", idType: " Postal ID " }, { kind: "id", title: "  ", idType: "UMID" }]), { added: 2, skipped: 0 });
  assert.deepEqual(data.entries.map((e) => e.title), ["Postal ID", "UMID"]);
  assert.throws(() => importEntries(data, [{ kind: "note", body: "x" }]), /Item 1 has no title/);
});

test("sync: an ID's number and photo are their own secret groups", () => {
  assert.equal(groupOf("id", "idType"), "core");
  assert.equal(groupOf("id", "idNumber"), "idnum");
  assert.equal(groupOf("id", "photo"), "photo");
  assert.ok(SECRET_GROUPS.includes("idnum") && SECRET_GROUPS.includes("photo"));
});
