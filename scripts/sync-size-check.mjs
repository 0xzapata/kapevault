// SYNC.md 3.11 check 2: how big `sync` makes a vault. Builds a busy vault through the real stamping
// (300 items edited on 3 devices, 2,000 items deleted) and prints the sizes with and without `sync`.
// Walk away from "tombstones forever" if `sync` passes 2 MB or the vault gets within 25% of
// MAX_VAULT_BYTES. Run: node scripts/sync-size-check.mjs. Mock data only; nothing is written.
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { newSync, stamp, newVaultData } from "../core/index.js";

const require = createRequire(import.meta.url);
const { createKey, encryptWithKey, MAX_VAULT_BYTES } = require("../electron/vault-crypto.cjs");

const ITEMS = 300;
const DELETED = 2000;
const DEVICES = [randomUUID(), randomUUID(), randomUUID()];
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const MB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

let now = Date.parse("2026-09-26T00:00:00Z");
const data = newVaultData();
data.sync = newSync(data, "AAAAAAAAAAAAAAAAAAAAAA==");

// One save on one device, stamped the way persist() stamps it.
function save(device, change) {
  const saved = { ...data };
  change();
  data.sync = stamp(saved, data, { installId: device, now: (now += 1000), sha256 });
}

function mockItem(i, spaceId) {
  const base = { id: randomUUID(), spaceId, title: `Mock item ${i}`, tags: ["mock"], favorite: false, notes: "Mock notes line.", updatedAt: "2026-09-26" };
  const kind = ["login", "login", "login", "note", "payee", "device"][i % 6];
  if (kind === "login") return { ...base, kind, username: `mock.user${i}@example.com`, password: `Mock-Pass-${i}-xxxxxxxx`, url: `https://mock${i}.example.com`, signIn: "password", totp: "otpauth://totp/Mock?secret=JBSWY3DPEHPK3PXP", history: [1, 2, 3].map((n) => ({ password: `Mock-Old-${i}-${n}`, changedAt: "2026-01-01" })), passwordChangedAt: "2026-09-26" };
  if (kind === "note") return { ...base, kind, body: "Mock body. ".repeat(50) };
  if (kind === "payee") return { ...base, kind, who: "Mock Tita", provider: "GCash", number: "09171234567", confirmedAt: "2026-09-26" };
  return { ...base, kind, type: "router", model: "Mock AX10", adminPassword: "mock-admin", ssid: "Mock_Home", wifiPassword: "mock-wifi" };
}

const edit = (i, fields) => () => (data.entries = data.entries.map((e, n) => (n === i ? { ...e, ...fields } : e)));
const personal = data.spaces[0].id;

// 10 client spaces, then 300 items, then every device edits every item in three groups over three rounds.
for (let s = 0; s < 10; s++) save(DEVICES[s % 3], () => (data.spaces = [...data.spaces, { id: randomUUID(), name: `Mock Client ${s}`, kind: "client" }]));
for (let i = 0; i < ITEMS; i++) save(DEVICES[i % 3], () => (data.entries = [...data.entries, mockItem(i, data.spaces[i % data.spaces.length].id)]));
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < ITEMS; i++) {
    const device = DEVICES[(i + round) % 3];
    save(device, edit(i, { title: `Mock item ${i} r${round}` }));
    save(device, edit(i, { favorite: round % 2 === 0 }));
    save(device, edit(i, { notes: `Mock notes, round ${round}.` }));
  }
}
// 2,000 items made on one device, edited on another, deleted on the third.
for (let d = 0; d < DELETED; d++) {
  const [maker, editor, deleter] = [DEVICES[d % 3], DEVICES[(d + 1) % 3], DEVICES[(d + 2) % 3]];
  const item = mockItem(d, personal);
  save(maker, () => (data.entries = [...data.entries, item]));
  save(editor, () => (data.entries = data.entries.map((e) => (e.id === item.id ? { ...e, title: `${e.title} edited` } : e))));
  save(deleter, () => (data.entries = data.entries.filter((e) => e.id !== item.id)));
}

const { sync, ...withoutSync } = data;
const { key, kdf, salt } = await createKey("mock size check pass phrase");
const fileBytes = (plain) => Buffer.byteLength(JSON.stringify(encryptWithKey(key, kdf, salt, plain)));
const syncBytes = Buffer.byteLength(JSON.stringify(sync));
const withFile = fileBytes(data);
const withoutFile = fileBytes(withoutSync);
const limit = MAX_VAULT_BYTES * 0.75;

console.log(`items ${data.entries.length}, spaces ${data.spaces.length}, meta ${Object.keys(sync.meta).length}, tombstones ${Object.keys(sync.gone).length}, devices ${DEVICES.length}`);
console.log(`sync JSON:          ${MB(syncBytes)} (${syncBytes} bytes; walk away over 2.00 MB)`);
console.log(`  meta ${MB(Buffer.byteLength(JSON.stringify(sync.meta)))}, gone ${MB(Buffer.byteLength(JSON.stringify(sync.gone)))}`);
console.log(`vault file without: ${MB(withoutFile)}`);
console.log(`vault file with:    ${MB(withFile)} (+${MB(withFile - withoutFile)})`);
console.log(`room for the rest (label photos, notes) before 75% of MAX_VAULT_BYTES: ${MB(limit - withFile)} of ${MB(MAX_VAULT_BYTES)}`);
console.log(syncBytes > 2 * 1024 * 1024 || withFile > limit ? "WALK AWAY: design a checked tombstone GC" : "PASS");
