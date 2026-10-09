// Real-window proof: a mock old BOVault folder is carried into a fresh KAPEVault data dir and unlocks.
// Part of npm run e2e. Throwaway folders only - the real %APPDATA%/BOVault is never read.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createVaultSession } = require("../electron/vault-session.cjs");
const { createHarness } = require("./e2e-harness.cjs");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-carry-"));
  const legacy = path.join(root, "BOVault");
  const data = path.join(root, "KAPEVault");
  fs.mkdirSync(legacy);
  const old = createVaultSession(path.join(legacy, "vault.bovault"));
  await old.create("correct horse battery orbit gazelle");
  old.importEntries([{ space: "Acme Client", kind: "login", title: "Mock Carry Login", username: "team@acme.test", password: "pw-1" }]);
  old.lock();
  const f = path.join(legacy, "vault.bovault");
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), format: "bovault" }));
  const before = fs.readFileSync(f);

  const h = createHarness();
  const { app, page, errors } = await h.launch({ KAPEVAULT_DATA_DIR: data, KAPEVAULT_LEGACY_DIR: legacy });
  h.check("vault copied into the new folder", fs.existsSync(path.join(data, "vault.kapevault")));
  await page.getByPlaceholder("Master password", { exact: true }).fill("correct horse battery orbit gazelle");
  await page.keyboard.press("Enter");
  h.check("old vault unlocks in KAPEVault and shows its items", await page.getByText("Mock Carry Login").first().waitFor({ timeout: 20000 }).then(() => true, () => false));
  h.check("window title is KAPEVault", (await page.title()) === "KAPEVault");
  h.check("old folder untouched", fs.readFileSync(f).equals(before));

  // Settings > General offers to delete the old copy, on a second click; no old install in a test run.
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Settings" }).click();
  h.check("Settings shows the old BOVault vault", await dialog.getByText("Old vault", { exact: true }).waitFor({ timeout: 4000 }).then(() => true, () => false));
  h.check("it says the old master password opens it", await dialog.getByText(/Opens with your old master password/).isVisible());
  h.check("no old install warning in a test run", (await dialog.getByText(/BOVault is still installed/).count()) === 0);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  h.check("asking deleted nothing yet", fs.existsSync(f));
  h.check("a forgotten old password: it says the folder can go by hand", await dialog.getByText(/Forgot it\? Delete the folder by hand/).isVisible());
  // Only the OLD vault's own master password deletes it - being unlocked here proves nothing about it.
  const oldPw = dialog.getByLabel("Old master password");
  await oldPw.fill("mock wrong passphrase");
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  h.check("a wrong old password deletes nothing", await dialog.getByText("Wrong master password for that vault.").waitFor({ timeout: 8000 }).then(() => fs.existsSync(f), () => false));
  await oldPw.fill("correct horse battery orbit gazelle");
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  h.check("Confirm delete removes the old vault", await dialog.getByText("Old vault", { exact: true }).waitFor({ state: "hidden", timeout: 4000 }).then(() => !fs.existsSync(f), () => false));
  h.check("the empty old folder goes too", !fs.existsSync(legacy));
  h.check("the new vault is untouched", fs.existsSync(path.join(data, "vault.kapevault")));
  h.check("no page errors", errors.length === 0, errors.join(" | "));
  await app.close();
  process.exit(h.report() ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
