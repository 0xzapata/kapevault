// node src/app/host/test/two-device.mjs - PC <-> phone sync on the KAPEVault emulator (start it headless
// first: `npm run sim -- --no-window`; the app must be a debug build of this branch).
//
// Two devices, one fake R2 bucket on this PC (test/fixtures.mjs, every signature checked with the PC's
// signer): the PHONE is the real host inside the app's own WebView (real Filesystem, CapacitorHttp,
// VaultKeystore), reaching the bucket through adb reverse, as in device-proof.mjs; the PC is the PC's
// REAL session, cloud backup and sync loop (electron/vault-session.cjs, cloud-backup.cjs, sync.cjs) in
// this Node process (fixtures.mjs pcDevice). Part 1 drives the phone's host over DevTools: names both
// ways, edits both ways, a conflict copy, a delete, the delete gate, a master password changed on the
// PC, a restore made the vault on all devices, with the check codes compared after each. Part 2 is the
// app itself (main.tsx's host): the sync line, the Sync sheet, the review sheet, removal from sync, and
// the warning before restoring a backup from before the newer master password. Leaves the app with no
// data. Output: mobile/proof/two-device/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { APP, kapevaultDevice, sleep } from "../../../../scripts/lib/device.mjs";
import { R2_KEYS, fakeR2, pc, pcDevice } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..", "..");
const out = path.join(root, "proof", "two-device");
const MASTER = "Lantern-Mango-Quiet-47 orbit gazelle";
const NEW_MASTER = "Harbor-Kettle-Violet-62 orbit gazelle";
const PC_ID = "9d9d9d9d-1c1d-4e5f-8a9b-0c1d2e3f4a5b";
const CDP_PORT = 9335;
const results = [];
fs.mkdirSync(out, { recursive: true });

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

// --- adb and the page (scripts/lib/device.mjs) ---------------------------------------------------------

const { sh, clearAppFiles, appFile, ownPro, ...device } = kapevaultDevice("two-device");
const openPage = ({ restart }) => device.openPage({ port: CDP_PORT, out, restart, answerMs: 90_000 });

// The host under test, bundled the way Vite builds the app (IIFE, "@core" = ../core).
async function bundle() {
  const dir = path.join(out, "bundle");
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: { "@core": path.join(root, "..", "core", "index.js") } },
    build: { outDir: dir, emptyOutDir: true, minify: false, lib: { entry: path.join(here, "device-entry.ts"), formats: ["iife"], name: "KVProof", fileName: () => "proof-host.js" } },
  });
  return fs.readFileSync(path.join(dir, "proof-host.js"), "utf8");
}

// --- the two devices -----------------------------------------------------------------------------------

const r2 = await fakeR2();
const desk = pcDevice(r2, { id: PC_ID, name: "DESKTOP-4F2A" });
const pcSync = async () => {
  for (let i = 0; i < 200 && desk.sync.status().state === "running"; i += 1) await sleep(50);
  return desk.sync.syncNow();
};
const pcEntry = (title) => desk.vault.publicView().entries.find((e) => e.title === title);
sh("reverse", `tcp:${r2.port}`, `tcp:${r2.port}`);

let page;
try {
  const personal = (await desk.vault.create(MASTER)).vault.spaces[0].id;
  desk.vault.setCloud(pc.cloud.configFromInput(R2_KEYS));
  const { id: mail } = desk.vault.saveEntry({ kind: "login", spaceId: personal, title: "Mail", username: "sam.home@example.com", password: "Mail-Pass-2291!", url: "mail.example.com" });
  const { id: note } = desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Server steps", body: "1. SSH in." });
  for (let i = 0; i < 8; i += 1) desk.vault.saveEntry({ kind: "link", spaceId: personal, title: `Link ${i}`, linkType: "web", location: `https://example.com/${i}` });
  await desk.cloud.backupNow();

  // ===== Part 1: the phone's real host over DevTools =====
  sh("logcat", "-c");
  clearAppFiles();
  ownPro(); // sync is KAPEVault Pro's; the fresh install at the end restores without it
  page = await openPage({ restart: true });
  await page.goto("/shell.html");
  const injected = await page.evaluate(`${await bundle()}; window.__h = KVProof.proofHost(${r2.port});
    window.__idle = async () => { for (let i = 0; i < 600; i++) { const s = await __h.syncStatus(); if (s.state !== "syncing") return s; await new Promise((r) => setTimeout(r, 100)); } return null; };
    window.__sync = async () => { await __idle(); const result = await __h.syncNow(); return { result, status: await __idle() }; };
    window.__titles = async () => (await __h.view()).entries.map((e) => e.title).sort();
    __h.state()`);
  check("the phone's real host starts at first run", injected === "first-run", injected);

  const backups = await page.evaluate(`__h.listBackups(${JSON.stringify(R2_KEYS)})`);
  const restored = await page.evaluate(`__h.restore(${JSON.stringify(R2_KEYS)}, ${JSON.stringify(backups.backups?.[0]?.key)}, ${JSON.stringify(MASTER)})`);
  await page.evaluate("__idle()");
  check("the phone restores the PC's backup and syncs after the unlock", restored.ok === true, restored);

  await pcSync();
  const first = await page.evaluate("__sync()");
  await pcSync();
  const model = first.status?.devices?.[0]?.model;
  const onPc = desk.sync.status();
  check("device names: the PC lists the phone by its model, as an Android device", onPc.devices.some((d) => d.name === model && d.platform === "android"), { model, pc: onPc.devices.map((d) => [d.name, d.platform]) });
  // A device names itself on its first sync (registerDevice): the PC's backup above was made before it
  // ever synced, so it is named from the pcSync above, and the phone learns the name on the sync after.
  const named = await page.evaluate("__sync()");
  check("device names: the phone lists DESKTOP-4F2A (a Windows PC) and says Synced with DESKTOP-4F2A", named.status?.devices?.some((d) => d.name === "DESKTOP-4F2A" && d.platform === "windows") && named.status?.peer === "DESKTOP-4F2A", named.status);
  const same = async (label) => {
    await pcSync();
    const phone = await page.evaluate("__sync()");
    await pcSync();
    const s = await page.evaluate("__sync()");
    check(`check codes match: ${label}`, s.status?.fingerprint === desk.sync.status().fingerprint && Boolean(s.status?.fingerprint), { phone: s.status?.fingerprint, pc: desk.sync.status().fingerprint, problems: phone.status?.problems });
  };
  await same("after the first syncs");

  // Edits both ways.
  const { id: bank } = desk.vault.saveEntry({ kind: "login", spaceId: personal, title: "Bank", username: "sam", password: "Bank-Pass-1!", url: "bank.example.com" });
  await pcSync();
  await page.evaluate("__sync()");
  const bankSecret = await page.evaluate(`__h.getSecret(${JSON.stringify(bank)}, "password")`);
  check("a PC edit reaches the phone, its password included", (await page.evaluate("__titles()")).includes("Bank") && bankSecret === "Bank-Pass-1!");
  const phoneNote = await page.evaluate(`__h.saveEntry({ kind: "note", spaceId: ${JSON.stringify(personal)}, title: "Phone note", tags: [], favorite: false, notes: "", body: "typed on the phone" })`);
  await page.evaluate("__sync()");
  await pcSync();
  check("a phone edit reaches the PC, its secret included", Boolean(pcEntry("Phone note")) && desk.vault.getSecret(phoneNote.id, "body") === "typed on the phone");

  // The same item on both before a sync.
  desk.vault.saveEntry({ id: note, kind: "note", spaceId: personal, title: "Server steps", body: "PC version" });
  desk.vault.saveEntry({ id: mail, kind: "login", spaceId: personal, title: "Mail", username: "sam.home@example.com", password: "PC-Pass-5510!", url: "mail.example.com" });
  await page.evaluate(`__h.saveEntry({ id: ${JSON.stringify(note)}, kind: "note", spaceId: ${JSON.stringify(personal)}, title: "Server steps", tags: [], favorite: false, notes: "", body: "Phone version" })`);
  await page.evaluate(`__h.saveEntry({ id: ${JSON.stringify(mail)}, kind: "login", spaceId: ${JSON.stringify(personal)}, title: "Mail", tags: [], favorite: false, notes: "", username: "sam.home@example.com", password: "Phone-Pass-7731!", url: "mail.example.com", signIn: "password" })`);
  await same("after both changed the same items");
  const phoneCopies = await page.evaluate(`(async () => (await __h.view()).entries.filter((e) => / \\(conflict copy, /.test(e.title)).map((e) => e.id))()`);
  const pcCopies = desk.vault.publicView().entries.filter((e) => / \(conflict copy, /.test(e.title)).map((e) => e.id);
  const bodies = await page.evaluate(`Promise.all([__h.getSecret(${JSON.stringify(note)}, "body"), __h.getSecret(${JSON.stringify(phoneCopies?.[0] ?? "")}, "body")])`);
  check("both changed a note: one conflict copy, the same id on both, both texts kept", Array.isArray(phoneCopies) && phoneCopies.length === 1 && String(pcCopies) === String(phoneCopies) && String([...(bodies ?? [])].sort()) === "PC version,Phone version", { phoneCopies, pcCopies, bodies });
  // Anywhere in the history: the rows sort by their UTC timestamps, and the two devices' clocks decide.
  const passwords = await page.evaluate(`Promise.all([__h.getSecret(${JSON.stringify(mail)}, "password"), ...[0, 1, 2, 3, 4].map((i) => __h.getSecret(${JSON.stringify(mail)}, "history", i))])`);
  const [current, ...history] = passwords ?? [];
  const lost = current === "PC-Pass-5510!" ? "Phone-Pass-7731!" : "PC-Pass-5510!";
  check("both changed a password: no copy, the losing one in its history", ["PC-Pass-5510!", "Phone-Pass-7731!"].includes(current) && history.includes(lost) && !desk.titles().some((t) => t.startsWith("Mail (conflict copy")), passwords);
  const conflicts = (await page.evaluate("__h.syncStatus()")).conflicts;
  check("the phone's Sync status lists the copy under Needs a look, with the original", conflicts?.length === 1 && conflicts[0].originalId === note, conflicts);

  // A delete, and the delete gate.
  const link0 = pcEntry("Link 0").id;
  await page.evaluate(`__h.deleteEntry(${JSON.stringify(link0)})`);
  await page.evaluate(`__h.deleteForever(${JSON.stringify(link0)})`); // a move to the Trash never syncs as a delete
  await page.evaluate("__sync()");
  await pcSync();
  check("a delete on the phone is a delete on the PC", !pcEntry("Link 0"));
  const six = ["Link 1", "Link 2", "Link 3", "Link 4", "Link 5", "Link 6"];
  for (const title of six) {
    const { id } = pcEntry(title);
    desk.vault.deleteEntry(id);
    desk.vault.deleteForever(id);
  }
  await pcSync();
  const gated = await page.evaluate("__sync()");
  const kept = await page.evaluate("__titles()");
  check("6 deletes from the PC wait for a review on the phone; nothing is deleted yet", String(gated.status?.review?.reasons) === "deletes" && gated.status.review.deleted.length === 6 && six.every((t) => kept.includes(t)), gated.status?.review);
  const applied = await page.evaluate("__h.applySync()");
  const after = await page.evaluate("__titles()");
  check("Apply deletes them", applied.ok === true && !six.some((t) => after.includes(t)), { applied, after });
  await same("after the reviewed deletes");

  // A new master password on the PC.
  const oldBackup = [...r2.objects.keys()].filter((k) => k.includes(PC_ID)).sort().at(-1); // under MASTER, from before the change
  check("the PC changes its master password", (await desk.vault.changeMaster(MASTER, NEW_MASTER)).ok === true);
  await pcSync();
  const asked = await page.evaluate("__sync()");
  check("the phone says the PC has a new master password", asked.status?.newMaster === "DESKTOP-4F2A", asked.status);
  const wrong = await page.evaluate(`__h.adoptSyncKey("not it at all")`);
  check("a wrong one is refused", wrong.ok === false && /DESKTOP-4F2A/.test(wrong.error), wrong);
  const adopted = await page.evaluate(`__h.adoptSyncKey(${JSON.stringify(NEW_MASTER)})`);
  const keyReview = await page.evaluate("__h.syncStatus()");
  const keyApplied = await page.evaluate("__h.applySync()");
  check("the right one opens it, a review follows, Apply adopts it", adopted.ok === true && String(keyReview.review?.reasons) === "key" && keyApplied.ok === true, { adopted, keyReview: keyReview.review, keyApplied });
  const phoneFile = JSON.parse(appFile("vault.kapevault"));
  check("the phone's vault file now opens with the new master password (the PC's own code)", Boolean(await pc.crypto.openFile(NEW_MASTER, phoneFile)));
  await same("after adopting the new master password");
  check("the PC opens the phone's snapshots with no prompt", desk.sync.status().newMaster === null && desk.sync.status().problems.length === 0, desk.sync.status().problems);

  // A restore on the PC, made the vault on all devices.
  const backupKey = [...r2.objects.keys()].filter((k) => k.includes(PC_ID)).sort().at(-1);
  const backup = r2.objects.get(backupKey).toString("utf8");
  desk.vault.saveEntry({ kind: "note", spaceId: personal, title: "Made after the backup", body: "x" });
  await pcSync();
  await page.evaluate("__sync()");
  await page.evaluate(`__h.saveEntry({ kind: "note", spaceId: ${JSON.stringify(personal)}, title: "Phone only", tags: [], favorite: false, notes: "", body: "y" })`);
  const verified = await desk.vault.verifyBackup(backup, NEW_MASTER);
  desk.vault.commitRestore(backup, verified.opened, { cloud: desk.vault.cloudConfig() });
  desk.sync.pauseAfterRestore();
  await desk.sync.answerRestore(true);
  const epoch = await page.evaluate("__sync()");
  const epochApplied = await page.evaluate("__h.applySync()");
  const epochTitles = await page.evaluate("__titles()");
  check("a restore made the vault on all devices: the phone waits for a review, then follows, its own new item kept as a copy", String(epoch.status?.review?.reasons) === "epoch" && epochApplied.ok === true && epochTitles.some((t) => t.startsWith("Phone only (conflict copy")), { review: epoch.status?.review, epochTitles });
  await same("after the restore everywhere");
  await page.evaluate("__h.lock()");

  // ===== Part 2: the app itself (main.tsx's host), its R2 calls bent to the fake bucket =====
  // A DevTools script added before the app's code bends only the URL of each native HTTP call to an R2
  // host, to the fake bucket (as device-proof.mjs does). It lasts for this DevTools session.
  async function appWithFakeR2() {
    page?.close();
    page = await openPage({ restart: true });
    await page.send("Page.enable"); // without it the WebView never runs the script below
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `document.addEventListener("readystatechange", () => {
        const cap = window.Capacitor;
        if (!cap?.nativePromise || cap.toFakeR2) return;
        const call = (cap.toFakeR2 = cap.nativePromise);
        cap.nativePromise = (plugin, method, options) => {
          const u = plugin === "CapacitorHttp" && method === "request" ? new URL(options.url) : null;
          if (!u || !u.hostname.endsWith(".r2.cloudflarestorage.com")) return call(plugin, method, options);
          return call(plugin, method, { ...options, url: "http://localhost:${r2.port}" + u.pathname + u.search, headers: { ...options.headers, "x-test-host": u.host } });
        };
      });`,
    });
    await page.send("Page.reload", {});
    await page.loaded("/");
  }
  await appWithFakeR2();
  await page.text(/Enter your master password/);
  const fill = (name, value) =>
    page.evaluate(`(() => {
      const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === ${JSON.stringify(name)} || i.getAttribute("aria-label") === ${JSON.stringify(name)} || i.closest("label")?.querySelector("span")?.textContent === ${JSON.stringify(name)});
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  await fill("Master password", NEW_MASTER);
  await page.evaluate(`document.querySelector("form")?.requestSubmit()`);
  let text = await page.text(/Synced with DESKTOP-4F2A/, 40_000);
  await page.screenshot("1-sync-line.png");
  check("the app: the sync line under the item count says Synced with DESKTOP-4F2A", /Synced with DESKTOP-4F2A · /.test(text), text.slice(0, 200));
  await page.clickStarting("Synced with");
  text = await page.text(/Check code/);
  await page.screenshot("2-sync-sheet.png");
  check("the Sync sheet lists This phone and DESKTOP-4F2A, and the check code the PC shows", /This phone/.test(text) && /DESKTOP-4F2A/.test(text) && text.includes(desk.sync.status().fingerprint), text.slice(0, 300));

  // The delete gate in the app: every item the PC has goes.
  for (const e of desk.vault.publicView().entries) {
    desk.vault.deleteEntry(e.id);
    desk.vault.deleteForever(e.id);
  }
  await pcSync();
  await page.click("Sync now");
  text = await page.text(/wait for you before they sync/, 30_000);
  await page.screenshot("3-review-waits.png");
  check("the Sync sheet says changes from DESKTOP-4F2A wait, with Review", /Changes from DESKTOP-4F2A wait for you before they sync/.test(text), text.slice(0, 300));
  await page.click("Review");
  text = await page.text(/Check before syncing/);
  await page.screenshot("4-review-sheet.png");
  check("the review sheet: who, how many, the titles, Not now and Apply", /DESKTOP-4F2A wants to delete \d+ items/.test(text) && /Not now/.test(text) && /Apply/.test(text), text.slice(0, 300));
  await page.click("Apply");
  await page.text(/Synced/, 20_000);
  const gone = await page.evaluate(`[...document.querySelectorAll("[role=dialog]")].length`);
  await page.click("Done");
  await sleep(600);
  text = await page.text(/All items/);
  check("Apply: the items are gone from the list", !/Server steps/.test(text) && !/Phone note/.test(text), { dialogs: gone, text: text.slice(0, 200) });

  // Removed on the PC.
  desk.sync.revoke(desk.sync.status().devices.find((d) => d.platform === "android").ref);
  await pcSync();
  await page.clickStarting("Synced with");
  await page.text(/Sync now/);
  await page.click("Sync now");
  text = await page.text(/removed from sync/, 30_000);
  await page.screenshot("5-removed.png");
  check("removed on the PC: the phone says so and stops syncing", /This phone was removed from sync on another device/.test(text), text.slice(0, 300));
  await page.click("Done");
  await sleep(600);
  check("the sync line says it too", /This phone was removed from sync/.test(await page.text(/removed from sync/)));

  // The warning before restoring a backup from before the newer master password (a fresh install).
  page.close();
  page = null;
  sh("shell", "am", "force-stop", APP);
  clearAppFiles();
  await appWithFakeR2();
  await page.text(/Choose a master password/);
  await page.click("Restore from backup");
  await page.text(/Type the keys instead/);
  await page.click("Type the keys instead");
  for (const [name, value] of [["S3 API URL", R2_KEYS.url], ["Access key ID", R2_KEYS.accessKeyId], ["Secret access key", R2_KEYS.secretAccessKey]]) await fill(name, value);
  await page.click("Connect");
  await page.text(/Pick a backup/, 30_000);
  // The backups show newest first by R2's clock (a stable sort of the listing, as backupsOf sorts it):
  // pick the one made before the change.
  const listing = [...r2.objects.keys()].filter((k) => k.startsWith("kapevault/snapshots/")).sort((a, b) => r2.modified.get(b) - r2.modified.get(a));
  const index = listing.indexOf(oldBackup);
  await page.evaluate(`[...document.querySelectorAll("[role=radio]")][${index}]?.click()`);
  await page.click("Use this backup");
  await page.text(/Master password for this backup/);
  await fill("Master password", MASTER);
  await page.evaluate(`document.querySelector("form")?.requestSubmit()`);
  text = await page.text(/Restore anyway/, 60_000);
  await page.screenshot("6-older-backup-warning.png");
  check("restoring a backup from before the newer master password: said plainly, Restore anyway or Pick another backup", /before the master password was changed on DESKTOP-4F2A/.test(text) && /Restore anyway/.test(text) && /Pick another backup/.test(text), text.slice(0, 300));
  await page.click("Restore anyway");
  text = await page.text(/All items|Unlock with your fingerprint/, 60_000);
  check("Restore anyway restores it", /All items|Unlock with your fingerprint/.test(text), text.slice(0, 160));

  const logcat = sh("logcat", "-d").split("\n").filter((line) => !/ I adbd\s*:/.test(line)).join("\n");
  const leaked = { master: logcat.includes(MASTER), newMaster: logcat.includes(NEW_MASTER), secret: logcat.includes(R2_KEYS.secretAccessKey), password: logcat.includes("Bank-Pass-1!") };
  check("no master password, stored password or R2 secret reaches logcat", !Object.values(leaked).some(Boolean), leaked);
} catch (e) {
  check("the proof ran to the end", false, e.stack ?? String(e));
} finally {
  page?.close();
  desk.sync.locked();
  try {
    sh("shell", "am", "force-stop", APP);
    clearAppFiles();
    sh("reverse", "--remove", `tcp:${r2.port}`);
  } catch {
    // best effort
  }
  await r2.close();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Report: ${path.join(out, "report.json")}`);
  process.exitCode = failed ? 1 : 0;
}
