// Two PCs syncing through one (fake) R2 bucket, each a real window with its own throwaway vault and
// install id (SYNC.md 3.5, 3.9). PC B starts from PC A's vault file, as a restore would.
// Run: npm run build && node scripts/e2e-sync.cjs (the launcher lives in e2e-harness.cjs)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHarness, shows, gone, waitFor } = require("./e2e-harness.cjs");
const { decodeQr } = require("../electron/qr-scan.cjs");

const MASTER = "sync test kettle harbor pass orbit gazelle";
const NEW_MASTER = "a new sync master phrase orbit gazelle";
const SHOTS = os.tmpdir();
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-a-"));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-b-"));
const { check, launch, lockedBy, report } = createHarness();

// A fake R2 bucket that stamps LastModified by its own clock: every PUT one second after the last.
const r2 = { objects: new Map(), modified: new Map(), clock: Date.now(), puts: 0 };
const r2Server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const u = new URL(req.url, "http://local");
    const [, bucket, ...rest] = u.pathname.split("/");
    const key = rest.join("/");
    const reply = (status, body = "") => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(body);
    };
    if (!/Credential=e2e-key-id\//.test(req.headers.authorization || "") || bucket !== "kapevault-e2e") return reply(403, "<Error><Code>InvalidAccessKeyId</Code></Error>");
    if (req.method === "PUT") {
      r2.puts += key.startsWith("kapevault/snapshots/") ? 1 : 0;
      r2.objects.set(key, Buffer.concat(chunks));
      r2.clock += 1000;
      r2.modified.set(key, r2.clock);
      return reply(200);
    }
    if (req.method === "DELETE") {
      r2.objects.delete(key);
      return reply(204);
    }
    if (req.method === "GET" && !key) {
      const prefix = u.searchParams.get("prefix") || "";
      const items = [...r2.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${new Date(r2.modified.get(k)).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
      return reply(200, `<ListBucketResult>${items.join("")}</ListBucketResult>`);
    }
    if (req.method === "GET" && r2.objects.has(key)) return reply(200, r2.objects.get(key));
    reply(404, "<Error><Code>NoSuchKey</Code></Error>");
  });
});
const r2Ready = new Promise((resolve) => r2Server.listen(0, "127.0.0.1", resolve));
const snapshotPuts = () => r2.puts; // snapshot uploads so far (thinning deletes some, so the objects are no count)

// KAPEVAULT_PHONE_CODE_SECONDS: Add a phone's code hides after 3 s here, not a minute.
const PHONE_CODE_SECONDS = 3;
const pc = (dataDir, name) =>
  launch({
    KAPEVAULT_DATA_DIR: dataDir,
    KAPEVAULT_DEVICE_NAME: name,
    KAPEVAULT_R2_ENDPOINT: `http://127.0.0.1:${r2Server.address().port}`,
    KAPEVAULT_BACKUP_DELAY_MS: "300",
    KAPEVAULT_SYNC_DELAY_MS: "300",
    KAPEVAULT_PHONE_CODE_SECONDS: String(PHONE_CODE_SECONDS),
    KAPEVAULT_BIOMETRIC_FAKE: "approve",
  });
const opened = []; // every window launched, for the page-error checks at the end

// The lock screen after a launch: the master password, then the list.
async function unlock(page, master) {
  await page.getByPlaceholder("Master password", { exact: true }).fill(master);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("[data-entry-list]").waitFor({ timeout: 15000 });
}

// The Add a phone code as the page draws it (an SVG path, module units), read by the app's own QR reader.
function readQr(d, size) {
  const quiet = 4;
  const scale = 4;
  const side = (size + quiet * 2) * scale;
  const pixels = Buffer.alloc(side * side * 4, 255);
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let px = (Number(x) + quiet) * scale; px < (Number(x) + Number(run) + quiet) * scale; px++) {
      for (let py = (Number(y) + quiet) * scale; py < (Number(y) + 1 + quiet) * scale; py++) pixels.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
    }
  }
  return decodeQr(pixels, side, side);
}
const installIdOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).installId;
const newestOf = (id) => [...r2.objects.keys()].filter((k) => k.includes(`/${id}/`) && !k.includes("before-restore")).sort((x, y) => r2.modified.get(y) - r2.modified.get(x))[0];

// The page's own bridge, for setup and for reading what the screen does not show (a secret's history).
const bridge = (page, fn, arg = null) => page.evaluate(`(${fn})(window.kapevault, ${JSON.stringify(arg)})`);
const line = (page) => page.locator("[data-sync-line] button");
const lineSays = (page, text) => waitFor(async () => ((await line(page).textContent().catch(() => "")) ?? "").includes(text), 15000);
const listed = (page, title) => page.locator("[data-entry-list]").getByRole("option", { name: new RegExp(`^${title.replace(/[()]/g, "\\$&")}`) });

// Sync now from the Sync sheet the line opens, then Done.
async function syncNow(page) {
  await line(page).click();
  const sheet = page.getByRole("dialog", { name: "Sync" });
  await sheet.getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(100); // the button turns off at once and back on when the upload after it is done
  await waitFor(async () => !(await sheet.getByRole("button", { name: "Sync now" }).isDisabled()), 15000);
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(page.getByRole("dialog"));
}

(async () => {
  await r2Ready;

  // PC A: a new vault with twelve items, backed up to the bucket.
  const a = await pc(dirA, "Mock PC A");
  await a.page.getByPlaceholder("Master password", { exact: true }).fill(MASTER);
  await a.page.getByPlaceholder("Confirm master password").fill(MASTER);
  await a.page.getByRole("button", { name: "Continue" }).click();
  await a.page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  const connected = await bridge(a.page, (api) => api.cloudConnect({ url: "https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e", accessKeyId: "e2e-key-id", secretAccessKey: "e2e-secret-value" }));
  check("PC A connects to the bucket", connected.ok === true, connected.error);
  const ids = await bridge(a.page, async (api) => {
    const spaceId = (await api.view()).spaces[0].id;
    const out = {};
    out.login = (await api.saveEntry({ kind: "login", spaceId, title: "Mock Portal", username: "mock.user", password: "pw-one" })).id;
    out.note = (await api.saveEntry({ kind: "note", spaceId, title: "Mock Note", body: "first" })).id;
    out.links = [];
    for (let i = 0; i < 10; i++) out.links.push((await api.saveEntry({ kind: "link", spaceId, title: `Mock link ${i}`, linkType: "web", location: `https://example.com/${i}` })).id);
    out.spaceId = spaceId;
    return out;
  });
  check("a connected vault shows the sync line", await lineSays(a.page, "Not synced yet"));
  await syncNow(a.page); // sends the waiting backup up
  check("PC A's vault is in the bucket", snapshotPuts() > 0);

  // PC B starts from PC A's vault file and syncs by itself after unlock.
  fs.copyFileSync(path.join(dirA, "vault.kapevault"), path.join(dirB, "vault.kapevault"));
  let b = await pc(dirB, "Mock PC B");
  await b.page.getByPlaceholder("Master password").fill(MASTER);
  await b.page.getByRole("button", { name: "Continue" }).click();
  await listed(b.page, "Mock Portal").waitFor({ timeout: 15000 });
  check("PC B syncs by itself after unlock", await lineSays(b.page, "Synced with"));
  await syncNow(a.page); // A meets B and registers its name
  await syncNow(b.page);
  check("the line names the other PC and when", await lineSays(b.page, "Synced with Mock PC A · just now"), await line(b.page).textContent());
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-1-line.png") });

  await line(b.page).click();
  const sheet = b.page.getByRole("dialog", { name: "Sync" });
  const devices = sheet.getByRole("list", { name: "Devices" });
  check("the Sync sheet lists this PC", await shows(devices.getByText("Mock PC B")));
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-2-sheet.png") });
  check("the Sync sheet lists the other PC with when it was last seen", (await shows(devices.getByText("Mock PC A"))) && (await shows(devices.getByText(/^Last seen/))));
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));

  // An edit on A reaches B.
  await bridge(a.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock shared note", body: "b" }), ids.spaceId);
  await syncNow(a.page);
  await syncNow(b.page);
  check("an edit on A reaches B", await shows(listed(b.page, "Mock shared note"), 8000));

  // Edits on both keep both: the login's losing password goes to history, the note's losing body to a copy.
  await bridge(a.page, async (api, { login, note, spaceId }) => {
    await api.saveEntry({ id: login, kind: "login", spaceId, title: "Mock Portal", username: "mock.user", password: "pw-from-a" });
    await api.saveEntry({ id: note, kind: "note", spaceId, title: "Mock Note", body: "from a" });
  }, ids);
  await syncNow(a.page);
  await bridge(b.page, async (api, { login, note, spaceId }) => {
    await api.saveEntry({ id: login, kind: "login", spaceId, title: "Mock Portal", username: "mock.user", password: "pw-from-b" });
    await api.saveEntry({ id: note, kind: "note", spaceId, title: "Mock Note", body: "from b" });
  }, ids);
  await syncNow(b.page);
  const history = await bridge(b.page, async (api, login) => [await api.getPassword(login), await api.getSecret(login, "history", 0), await api.getSecret(login, "history", 1)], ids.login);
  check("a login edited on both keeps the newer password and the other in history", history[0] === "pw-from-b" && history.slice(1).includes("pw-from-a"), history.join(", "));
  const copyTitle = /^Mock Note \(conflict copy, Mock PC A, /;
  check("a note edited on both gets a conflict copy", await shows(b.page.locator("[data-entry-list]").getByRole("option", { name: copyTitle }), 8000));
  await line(b.page).click();
  const look = b.page.getByRole("dialog", { name: "Sync" }).getByRole("list", { name: "Needs a look" });
  check("the Sync sheet lists the copy under Needs a look", await shows(look.getByRole("button", { name: copyTitle })));
  await look.getByRole("button", { name: copyTitle }).click();
  check("choosing it shows the copy", await shows(b.page.locator("h1", { hasText: "(conflict copy, Mock PC A," })));
  await gone(b.page.getByRole("dialog"));

  // A delete on A removes the item on B.
  // (Delete moves to the Trash; Delete now is the real delete that sync carries.)
  await bridge(a.page, (api, id) => api.deleteEntry(id).then(() => api.deleteForever(id)), ids.links[0]);
  await syncNow(a.page);
  await syncNow(b.page);
  check("a delete on A removes the item on B", await gone(listed(b.page, "Mock link 0")));

  // A mass delete on A waits for review on B.
  await bridge(a.page, async (api, links) => {
    for (const id of links) {
      await api.deleteEntry(id);
      await api.deleteForever(id);
    }
  }, ids.links.slice(1, 7));
  await syncNow(a.page);
  await syncNow(b.page);
  check("a mass delete stops at the review", await lineSays(b.page, "Changes from Mock PC A wait for you"));
  check("nothing is deleted before the review", await shows(listed(b.page, "Mock link 3")));
  await line(b.page).click();
  const review = b.page.getByRole("dialog", { name: "Check before syncing" });
  check("the review says who wants to delete how many", await shows(review.getByText("Mock PC A wants to delete 6 items.")));
  check("the review lists what would go", (await review.getByRole("list", { name: "Deleted" }).getByRole("listitem").count()) === 6);
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-3-review.png") });
  await review.getByRole("button", { name: "Apply" }).click();
  await gone(review);
  check("Apply deletes them", await gone(listed(b.page, "Mock link 3")));

  // Sync's own saves never start another sync, and nothing new uploads nothing.
  await syncNow(a.page);
  await syncNow(b.page);
  await b.page.waitForTimeout(1500);
  const puts = snapshotPuts();
  for (let i = 0; i < 3; i++) {
    await syncNow(a.page);
    await syncNow(b.page);
  }
  await b.page.waitForTimeout(1500);
  check("syncs with nothing new upload nothing, and sync's own save starts no loop", snapshotPuts() === puts, `${puts} -> ${snapshotPuts()}`);
  const printA = (await bridge(a.page, (api) => api.syncStatus())).fingerprint;
  await line(b.page).click();
  const checkCode = b.page.getByRole("dialog", { name: "Sync" }).getByText(printA, { exact: true });
  check("both PCs show the same check code after syncing", /^[0-9a-f]{8}$/.test(printA) && (await shows(checkCode)), printA);
  await b.page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));

  // Settings > Backup has Sync now too.
  await b.page.getByRole("button", { name: "Settings" }).click();
  await b.page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  check("Settings > Backup offers Sync now", await shows(b.page.getByRole("dialog").getByRole("button", { name: "Sync now" })));

  // Add a phone: the R2 keys as a QR code, exactly what the phone's setup-code.ts reads, gone after its time.
  const settings = b.page.getByRole("dialog");
  await settings.getByRole("button", { name: "Add a phone" }).click();
  const qr = settings.getByRole("img", { name: "Code for your phone" });
  check("Add a phone shows a QR code", await shows(qr));
  const [viewBox, d] = [await qr.getAttribute("viewBox"), await qr.locator("path").getAttribute("d")];
  const code = JSON.parse(readQr(d, Number(viewBox.split(" ")[2]) - 8) ?? "null");
  check(
    "the code reads back as the bucket URL and both keys",
    JSON.stringify(code) === JSON.stringify({ kapevault: "r2", v: 1, url: "https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e", accessKeyId: "e2e-key-id", secretAccessKey: "e2e-secret-value" }),
    JSON.stringify(code),
  );
  check("it says the code holds the keys and shows only here", await shows(settings.getByText("This code holds your R2 keys, so it shows only here and hides after a minute.")));
  await qr.scrollIntoViewIfNeeded();
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-4-add-phone.png") });
  check("the code hides by itself after its time", await waitFor(async () => !(await qr.isVisible()), (PHONE_CODE_SECONDS + 3) * 1000));
  check("and Add a phone is back", await shows(settings.getByRole("button", { name: "Add a phone" })));
  await settings.getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));

  // A backup of B to restore later, from before the changes below.
  const idB = installIdOf(dirB);
  await syncNow(b.page);
  const restorePoint = newestOf(idB);

  // One delete from A never waits for a review, even as more than 10% of the items.
  const total = (await bridge(b.page, (api) => api.view())).entries.length;
  await bridge(a.page, (api, id) => api.deleteEntry(id).then(() => api.deleteForever(id)), ids.links[7]);
  await syncNow(a.page);
  await syncNow(b.page);
  check(`one delete of ${total} items syncs with no review`, (await gone(listed(b.page, "Mock link 7"))) && !(await b.page.getByRole("dialog").isVisible()));
  check("and the line does not ask for one", !((await line(b.page).textContent()) ?? "").includes("wait for you"));

  // Automatic backup off on B: nothing syncs by itself, Sync now still does - and sends B's changes up.
  await bridge(b.page, (api) => api.cloudSetAuto(false));
  await bridge(a.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock while B is manual", body: "b" }), ids.spaceId);
  await syncNow(a.page);
  check("with automatic backup off the line says so", await lineSays(b.page, "only on Sync now"));
  await bridge(b.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock typed on manual B", body: "b" }), ids.spaceId);
  await b.page.waitForTimeout(1500);
  check("a save on B does not sync by itself", !(await listed(b.page, "Mock while B is manual").isVisible()));
  const putsBefore = snapshotPuts();
  await syncNow(b.page);
  check("Sync now syncs with automatic backup off", await shows(listed(b.page, "Mock while B is manual"), 8000));
  check("and sends B's vault up", snapshotPuts() > putsBefore, `${putsBefore} -> ${snapshotPuts()}`);
  await syncNow(a.page);
  check("so A gets B's change", await shows(listed(a.page, "Mock typed on manual B"), 8000));
  await bridge(b.page, (api) => api.cloudSetAuto(true));

  // B restores the backup from before: sync waits, and still waits after B is closed and opened again.
  const restored = await bridge(b.page, (api, key) => api.cloudRestore(key, undefined, "sync test kettle harbor pass orbit gazelle"), restorePoint);
  check("B restores an older backup", restored.ok === true, restored.error);
  check("after a restore the line says sync is paused", await lineSays(b.page, "Sync is paused after the restore"));
  await bridge(a.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock after the backup", body: "a" }), ids.spaceId);
  await syncNow(a.page);
  opened.push(["B", b.errors]);
  await b.app.close();
  b = await pc(dirB, "Mock PC B");
  await unlock(b.page, MASTER);
  await b.page.waitForTimeout(2000); // longer than an unlock's sync takes
  check("the pause survives closing and opening B", await lineSays(b.page, "Sync is paused after the restore"));
  check("and nothing synced meanwhile", !(await listed(b.page, "Mock after the backup").isVisible()) && (await shows(listed(b.page, "Mock link 7"))));

  // The question: B makes the restored vault the one on all devices, and A takes it after a review.
  await line(b.page).click();
  const question = b.page.getByRole("dialog", { name: "Sync" }).getByRole("region", { name: "After the restore" });
  check("the Sync sheet asks what the restore means for the other devices", await shows(question.getByText("You restored a backup. What about your other devices?")));
  await b.page.waitForTimeout(300); // the sheet has settled
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-5-restore-question.png") });
  await question.getByRole("button", { name: "Use it on all devices" }).click();
  check("the answer resumes sync", await gone(question));
  await b.page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));
  await syncNow(a.page);
  check("A is asked before it takes the restored vault", await lineSays(a.page, "Changes from Mock PC B wait for you"));
  await line(a.page).click();
  const epochReview = a.page.getByRole("dialog", { name: "Check before syncing" });
  check("the review says B made its backup the vault on all devices", await shows(epochReview.getByText("Mock PC B restored a backup and made it the vault on all devices.")));
  await epochReview.getByRole("button", { name: "Apply" }).click();
  await gone(epochReview);
  check("A takes the restored vault: the delete made after the backup is undone", await shows(listed(a.page, "Mock link 7"), 8000));
  const entryList = a.page.locator("[data-entry-list]");
  check(
    "and A's own later item is kept as a conflict copy",
    (await shows(entryList.getByRole("option", { name: /^Mock after the backup \(conflict copy, Mock PC A, / }))) && !(await entryList.getByRole("option", { name: /^Mock after the backup(?! \()/ }).isVisible()),
  );

  // A changes the master password; B, with Windows Hello on, types it once and adopts it.
  const hello = await bridge(b.page, (api) => api.biometricEnable());
  check("Windows Hello is on for B", hello.ok === true && hello.status.enabled === true, hello.error);
  const changedMaster = await bridge(a.page, (api, next) => api.changeMaster("sync test kettle harbor pass orbit gazelle", next), NEW_MASTER);
  check("A changes the master password", changedMaster.ok === true, changedMaster.error);
  await syncNow(a.page);
  await syncNow(b.page);
  check("B's line says A has a new master password", await lineSays(b.page, "Mock PC A has a new master password"));
  await line(b.page).click();
  const card = b.page.getByRole("dialog", { name: "Sync" }).getByRole("form", { name: "New master password" });
  await card.getByLabel("Master password set on Mock PC A").fill("not the right one");
  await card.getByRole("button", { name: "Continue" }).click();
  check("a wrong one is refused", await shows(card.getByText("That is not the master password set on Mock PC A.")));
  await card.getByLabel("Master password set on Mock PC A").fill(NEW_MASTER);
  await card.getByRole("button", { name: "Continue" }).click();
  const keyReview = b.page.getByRole("dialog", { name: "Check before syncing" });
  check("the right one opens a review", await shows(keyReview.getByText("Mock PC A set a new master password. After Apply it unlocks this vault too."), 15000));
  check("which says Windows Hello turns off", await shows(keyReview.getByText("Windows Hello turns off. You can turn it on again in Settings.")));
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-6-new-master.png") });
  await keyReview.getByRole("button", { name: "Apply" }).click();
  await gone(keyReview);
  await b.page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));
  check("B turned Windows Hello off", await waitFor(async () => !(await bridge(b.page, (api) => api.biometricStatus())).enabled, 8000));
  await lockedBy(b.app, b.page, () => bridge(b.page, (api) => api.lock()));
  await unlock(b.page, NEW_MASTER);
  check("B now unlocks with A's new master password", await lineSays(b.page, "Synced with"));

  // B's folder copied to a third PC: two installs, one id. B finds a snapshot it never sent and renews its id.
  await syncNow(b.page);
  opened.push(["B", b.errors]);
  await b.app.close();
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-sync-c-"));
  fs.cpSync(dirB, dirC, { recursive: true });
  const c = await pc(dirC, "Mock PC C");
  await unlock(c.page, NEW_MASTER);
  await bridge(c.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock from the copy", body: "c" }), ids.spaceId);
  await syncNow(c.page);
  b = await pc(dirB, "Mock PC B");
  await unlock(b.page, NEW_MASTER);
  check("B takes a new id when a copy of it uploads under its id", await waitFor(() => installIdOf(dirB) !== idB, 15000), installIdOf(dirB));
  check("and the copy keeps the old one", installIdOf(dirC) === idB);
  await syncNow(b.page);
  check("the copy's change reaches B as another device's", await shows(listed(b.page, "Mock from the copy"), 8000));
  opened.push(["C", c.errors]);
  await c.app.close();

  // B removes A from sync: A's changes never reach B again, and A says so.
  await line(b.page).click();
  const deviceList = b.page.getByRole("dialog", { name: "Sync" }).getByRole("list", { name: "Devices" });
  const rowA = deviceList.getByRole("listitem").filter({ hasText: "Mock PC A" });
  await rowA.getByRole("button", { name: "Remove from sync" }).click();
  check("removing asks first, and says two steps follow", await shows(rowA.getByText("Its changes will never sync again. For a lost or sold device. Two steps to lock it out for good follow.")));
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-7-remove.png") });
  await rowA.getByRole("button", { name: "Remove", exact: true }).click();
  check("the removed PC leaves the list", await gone(deviceList.getByText("Mock PC A")));
  const lockOut = b.page.getByRole("dialog", { name: "Sync" }).getByRole("region", { name: "Finish locking out" });
  check("and the lock-out steps appear at once: new master password, new R2 token", (await shows(lockOut.getByText("Finish locking out Mock PC A"))) && (await shows(lockOut.getByRole("button", { name: "Change master password..." }))) && (await shows(lockOut.getByText("2. Replace your R2 API token"))));
  await b.page.screenshot({ path: path.join(SHOTS, "e2e-sync-7b-lock-out.png") });
  await b.page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Done" }).click();
  await gone(b.page.getByRole("dialog"));
  await syncNow(b.page);
  // A's save goes up by itself (automatic backup); its sync after the save learns A was removed.
  const putsA = snapshotPuts();
  await bridge(a.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock from the removed PC", body: "a" }), ids.spaceId);
  await waitFor(() => snapshotPuts() > putsA, 8000);
  await syncNow(b.page);
  await b.page.waitForTimeout(1000);
  check("a removed PC's change never reaches B", !(await listed(b.page, "Mock from the removed PC").isVisible()));
  // A learns of its removal through a review first (SYNC.md 3.9): nothing switches it off unseen.
  // B's snapshot (the removal) is in it; C's joins it or not, depending on which sync caught it.
  const waiting = /^Changes from Mock PC B( and Mock PC C)? wait for you$/;
  let lineA = "";
  const lineWaits = async () => {
    lineA = ((await line(a.page).textContent().catch(() => "")) ?? "").trim();
    return waiting.test(lineA);
  };
  check("A's line says changes wait for it, not yet that it was removed", await waitFor(lineWaits, 15000), lineA);
  await line(a.page).click();
  const removalReview = a.page.getByRole("dialog", { name: "Check before syncing" });
  check("A's review says it was removed from sync, without blaming C", await shows(removalReview.getByText("This device was removed from sync on another device. After Apply it syncs no more."), 15000));
  await a.page.screenshot({ path: path.join(SHOTS, "e2e-sync-7c-removed-review.png") });
  await removalReview.getByRole("button", { name: "Apply" }).click();
  await gone(removalReview);
  check("after Apply, A's line says it was removed", await lineSays(a.page, "This device was removed from sync"));
  check("B's line keeps the reminder until the master password changes", await lineSays(b.page, "Finish locking out Mock PC A"));

  // Join again: A types the vault's master password and syncs under a new install id.
  const oldIdA = installIdOf(dirA);
  await line(a.page).click();
  const joinAgain = a.page.getByRole("dialog", { name: "Sync" }).getByRole("form", { name: "Join again" });
  check("A's Sync sheet offers Join again", await shows(joinAgain.getByText("This device was removed from sync. Type this vault's master password to join again.")));
  await a.page.screenshot({ path: path.join(SHOTS, "e2e-sync-7d-join-again.png") });
  await joinAgain.getByLabel("Master password").fill("not the right one");
  await joinAgain.getByRole("button", { name: "Join again" }).click();
  check("a wrong master password is refused", await shows(joinAgain.getByText("Wrong master password.")));
  await joinAgain.getByLabel("Master password").fill(NEW_MASTER);
  await joinAgain.getByRole("button", { name: "Join again" }).click();
  check("the right one brings A back: the line no longer says removed", await waitFor(async () => !((await line(a.page).textContent().catch(() => "")) ?? "").includes("removed from sync"), 15000));
  await a.page.getByRole("dialog", { name: "Sync" }).getByRole("button", { name: "Done" }).click();
  await gone(a.page.getByRole("dialog"));
  check("A took a new install id", installIdOf(dirA) !== oldIdA);
  await bridge(a.page, (api, spaceId) => api.saveEntry({ kind: "note", spaceId, title: "Mock from the PC that joined again", body: "a" }), ids.spaceId);
  await syncNow(a.page);
  await syncNow(b.page);
  check("sync works again: B gets what A saved after joining again", await shows(listed(b.page, "Mock from the PC that joined again"), 15000));

  for (const [name, errors] of [["A", a.errors], ...opened, ["B", b.errors]]) check(`no page errors on ${name}`, errors.length === 0, errors.join(" | "));
  await a.app.close();
  await b.app.close();
  fs.rmSync(dirC, { recursive: true, force: true });
  r2Server.closeAllConnections();
  r2Server.close();
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  process.exit(report() ? 0 : 1);
})().catch((e) => {
  report();
  console.log("CRASH:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
