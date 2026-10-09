// Test stand-ins for what native.ts gives the real host on the phone: files, HTTP, the VaultKeystore
// and SecureClipboard plugins. Plus a fake R2 bucket (after scripts/e2e.cjs) that checks every
// request's SigV4 signature with the PC's own signer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const pc = {
  crypto: require("../../../../../electron/vault-crypto.cjs"),
  r2: require("../../../../../electron/r2-client.cjs"),
  cloud: require("../../../../../electron/cloud-backup.cjs"),
  biometric: require("../../../../../electron/biometric-record.cjs"),
  session: require("../../../../../electron/vault-session.cjs"),
  qr: require("../../../../../electron/qr-encode.cjs"), // Settings > Backup > Add a phone
  sync: require("../../../../../electron/sync.cjs"),
};

export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-phone-"));

// A phone's folder as a KAPEVault Pro purchase leaves it (host/pro.ts): pro.json says owned, so the phone
// syncs and makes client folders. With no Billing plugin it keeps that, as offline.
export function withPro(dir) {
  fs.writeFileSync(path.join(dir, "pro.json"), JSON.stringify({ owned: true, pending: false }));
  return dir;
}

// The app's private files folder: reads as Filesystem does, saves as the DurableFile plugin does (write a
// temp file, then one atomic rename). faults.replace(name) fails a save before it touches anything.
export function nodeFs(dir, faults = {}) {
  const at = (name) => path.join(dir, name);
  return {
    async read(name) {
      try {
        return fs.readFileSync(at(name), "utf8");
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async replace(name, text) {
      if (faults.replace?.(name)) throw new Error("disk full");
      fs.writeFileSync(at(`${name}.tmp`), text);
      fs.renameSync(at(`${name}.tmp`), at(name));
    },
    async remove(name) {
      fs.rmSync(at(name), { force: true });
    },
  };
}

// VaultKeystore: holds the wrapped key in memory. next: what the next prompt does.
export function fakeKeystore({ available = true } = {}) {
  const k = { key: null, next: "approve", prompts: 0 };
  const reject = (code) => Promise.reject(Object.assign(new Error(code), { code }));
  return Object.assign(k, {
    isAvailable: async () => ({ available, enabled: k.key !== null }),
    async enable({ key }) {
      k.prompts++;
      if (k.next !== "approve") return reject(k.next);
      k.key = key;
    },
    async unlock() {
      if (k.key === null) return reject("not-enabled");
      k.prompts++;
      if (k.next === "changed") k.key = null;
      if (k.next !== "approve") return reject(k.next);
      return { key: k.key };
    },
    async disable() {
      k.key = null;
    },
  });
}

export function fakeClipboard() {
  const c = { text: "", sensitive: false, cleared: 0 };
  return Object.assign(c, {
    async copySecret(text) {
      Object.assign(c, { text, sensitive: true });
    },
    async copyText(text) {
      Object.assign(c, { text, sensitive: false });
    },
    async clear() {
      c.cleared++;
      if (c.sensitive) c.text = "";
    },
  });
}

// The phone's HTTP, as fetch against the fake bucket. Only the fake's http://127.0.0.1 is reachable:
// every other URL answers like no network.
export function fetchTransport(r2) {
  return async ({ method, url, headers, body }) => {
    const local = new URL(url);
    local.protocol = "http:";
    local.host = `127.0.0.1:${r2.port}`;
    const res = await fetch(local, { method, headers: { ...headers, "x-test-host": new URL(url).host }, body, redirect: "manual" });
    return { status: res.status, body: await res.text() };
  };
}

// A fake R2 bucket "kapevault-e2e" that only accepts access key "e2e-key-id" with secret
// "e2e-secret-value", and whose signature matches what the PC's signer makes of the same request.
export const R2_KEYS = { url: "https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e", accessKeyId: "e2e-key-id", secretAccessKey: "e2e-secret-value" };

export async function fakeR2() {
  const r2 = { objects: new Map(), modified: new Map(), requests: [], badSignatures: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = `https://${req.headers["x-test-host"]}${req.url}`;
      const u = new URL(url);
      const [, bucket, ...rest] = u.pathname.split("/");
      const key = decodeURIComponent(rest.join("/"));
      r2.requests.push({ method: req.method, key, headers: req.headers });
      const reply = (status, text = "") => {
        res.writeHead(status, { "content-type": "application/xml" });
        res.end(text);
      };
      const auth = req.headers.authorization || "";
      if (!/Credential=e2e-key-id\//.test(auth)) return reply(403, "<Error><Code>InvalidAccessKeyId</Code></Error>");
      const amz = req.headers["x-amz-date"];
      const now = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
      const expected = pc.r2.signRequest({ method: req.method, url, body, accessKeyId: R2_KEYS.accessKeyId, secretAccessKey: R2_KEYS.secretAccessKey, now });
      if (expected.authorization !== auth || expected["x-amz-content-sha256"] !== req.headers["x-amz-content-sha256"]) {
        r2.badSignatures++;
        return reply(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
      }
      if (bucket !== "kapevault-e2e") return reply(404, "<Error><Code>NoSuchBucket</Code></Error>");
      if (req.method === "PUT") return r2.objects.set(key, body), r2.modified.set(key, new Date()), reply(200);
      if (req.method === "DELETE") return r2.objects.delete(key), reply(204);
      if (req.method === "GET" && !key) {
        const prefix = u.searchParams.get("prefix") || "";
        const items = [...r2.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${(r2.modified.get(k) ?? new Date()).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
        return reply(200, `<ListBucketResult><IsTruncated>false</IsTruncated>${items.join("")}</ListBucketResult>`);
      }
      if (req.method === "GET" && r2.objects.has(key)) return reply(200, r2.objects.get(key));
      reply(404, "<Error><Code>NoSuchKey</Code></Error>");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  r2.port = server.address().port;
  r2.close = () => new Promise((resolve) => server.close(resolve));
  r2.put = (key, text, modified = new Date()) => (r2.objects.set(key, Buffer.from(text)), r2.modified.set(key, modified));
  return r2;
}

// The PC's own HTTP (its courier, curl on the real PC) as fetch against the fake bucket, the way
// fetchTransport carries the phone's.
export function pcTransport(r2) {
  return async ({ method, url, headers, body }) => {
    const local = new URL(url);
    local.protocol = "http:";
    local.host = `127.0.0.1:${r2.port}`;
    const res = await fetch(local, { method, headers: { ...headers, "x-test-host": new URL(url).host }, body, redirect: "manual" });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  };
}

// A PC wired as electron/main.cjs wires it, running the PC's REAL session, cloud backup and sync loop
// (electron/vault-session.cjs, cloud-backup.cjs, sync.cjs) against the fake bucket, in a folder of its
// own. A save schedules the backup and, unless sync made it, a sync (delayMs: automatic runs wait that
// long, so a test drives them with sync.syncNow()). rekeyed: how often it adopted another device's
// master password.
export function pcDevice(r2, { id, name = "DESKTOP-4F2A", dir = tempDir(), delayMs = 60_000 }) {
  const dev = { id, name, dir, file: path.join(dir, "vault.kapevault"), rekeyed: 0 };
  const installId = () => dev.id;
  let cloud = null;
  let sync = null;
  dev.vault = pc.session.createVaultSession(dev.file, {
    installId,
    onPersist: (save) => {
      cloud.schedule();
      if (!save.bySync) sync.afterSave();
    },
  });
  cloud = pc.cloud.createCloudBackup({ vault: dev.vault, installId, delayMs: 20, transport: pcTransport(r2) });
  sync = pc.sync.createSync({ vault: dev.vault, cloud, installId, device: { name, platform: "win32" }, delayMs, onRekeyed: () => dev.rekeyed++ });
  return Object.assign(dev, { cloud, sync, titles: () => dev.vault.publicView().entries.map((e) => e.title).sort() });
}

// A vault the PC writes (its own crypto), as text: the PC's cloud config and olderBackupsPending
// included, as a real PC snapshot has them.
export async function pcVaultText(master, data) {
  const { key, kdf, salt } = await pc.crypto.createKey(master);
  return { text: JSON.stringify(pc.crypto.encryptWithKey(key, kdf, salt, data)), key };
}

// A vault file the PC writes whose text is `under` characters (at most 4 more) under the phone's
// MAX_VAULT_BYTES: `data` plus one long note. Any write that grows it past the cap must be refused.
export function pcVaultNearCap({ key, kdf, salt }, data, spaceId, under, MAX) {
  const make = (n) => JSON.stringify(pc.crypto.encryptWithKey(key, kdf, salt, { ...data, entries: [...data.entries, longNote(spaceId, n)] }));
  let n = 0;
  let text = make(n);
  for (let i = 0; i < 3; i++) text = make((n += Math.floor(((MAX - under - text.length) * 3) / 4))); // base64: 4 chars per 3 bytes
  while (text.length > MAX - under) text = make(--n);
  if (text.length < MAX - under - 4) throw new Error(`near-cap vault is ${MAX - text.length} under`);
  return text;
}
const longNote = (spaceId, n) => ({ id: "e-long", spaceId, kind: "note", title: "Long", tags: [], favorite: false, notes: "", updatedAt: "2026-09-20", body: "x".repeat(n) });

// The same through the phone's own saves: one long note grown until the vault file is about `under`
// characters under the cap (the first save makes the note, the next two size it).
export async function fillNearCap(host, file, spaceId, under, MAX) {
  let id;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    if (i > 0) n += Math.floor(((MAX - under - fs.statSync(file).size) * 3) / 4);
    const saved = await host.saveEntry({ ...longNote(spaceId, n), id });
    if (!saved.ok) throw new Error(saved.error);
    id = saved.id;
  }
  const left = MAX - fs.statSync(file).size;
  if (left < 0 || left > under + 16) throw new Error(`near-cap vault is ${left} under`);
  return id;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}
