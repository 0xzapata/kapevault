// Cloud backup (R2) and sync: setup, backups, the snapshot list and Add a phone. Restoring a
// snapshot is in ipc/restore.cjs.
const { setupCode } = require("../cloud-backup.cjs");
const { encodeQr, qrPath } = require("../qr-encode.cjs");

const PHONE_CODE_SECONDS = 60; // Add a phone: how long the R2 keys show as a QR code

function register({ handle, attempt, vault, cloud, sync, broadcast, devEnv }) {
  // Cloud backup. A change to its setup changes what sync can do too, so the sync line hears of it
  // (cloudChanged).
  const cloudStatus = () => ({ settings: vault.status().unlocked ? vault.cloudView() : null, last: cloud.status(), openerReplaced: cloud.openerReplaced() });
  const cloudChanged = () => (broadcast("sync:status", sync.status()), cloudStatus());

  handle("cloud:status", () => cloudStatus());
  handle("cloud:connect", (input) =>
    attempt(async () => {
      const config = cloud.configFromInput(input, vault.cloudConfig());
      await cloud.list(input); // prove the URL and keys work before saving them
      vault.setCloud(config);
      await cloud.backupNow();
      return { status: cloudChanged() };
    }),
  );
  handle("cloud:setAuto", (auto) => {
    vault.setCloudAuto(Boolean(auto));
    return cloudChanged();
  });
  handle("cloud:disconnect", () => {
    vault.setCloud(null);
    return cloudChanged();
  });
  handle("cloud:forgetOlder", () =>
    attempt(async () => {
      const { deleted, refused } = await cloud.forgetOlder();
      if (refused === 0) vault.clearOlderBackups(); // old-password snapshots are still there while any delete is refused
      return { deleted, refused, status: cloudStatus() };
    }),
  );
  handle("cloud:backupNow", () =>
    attempt(async () => {
      await cloud.backupNow();
      return { status: cloudStatus() };
    }),
  );
  // Sync (sync.cjs): its status, Sync now, and Apply on a merge held for review. Main pushes every
  // change as sync:status.
  handle("sync:status", () => sync.status());
  handle("sync:now", () => sync.syncNow());
  handle("sync:apply", () => sync.apply());
  // The master password another device set, typed once to open its snapshots (a review follows).
  handle("sync:adoptKey", async (master) => ({ ...(await sync.adoptKey(String(master ?? ""))), status: sync.status() }));
  // After a restore: true = this vault on all devices, false = merge it in.
  handle("sync:answerRestore", (everywhere) => sync.answerRestore(everywhere === true));
  // A device by the ref the Sync sheet was given, never an install id.
  handle("sync:revoke", (ref) => sync.revoke(String(ref)));
  // A device that was removed from sync joins again: the vault's master password, proven on the vault file.
  handle("sync:rejoin", (master) => attempt(() => sync.rejoin(String(master ?? ""))));
  // Add a phone: the R2 keys as a QR code for the phone's first run. The one way the secret key reaches
  // the page - as the code's modules, on a click, unlocked and connected only; the page hides it after
  // `seconds`.
  handle("cloud:phoneCode", () =>
    attempt(() => {
      const config = vault.status().unlocked ? vault.cloudConfig() : null;
      if (!config) throw new Error("Connect cloud backup first.");
      const modules = encodeQr(setupCode(config));
      return { size: modules.length, path: qrPath(modules), seconds: Number(devEnv.KAPEVAULT_PHONE_CODE_SECONDS) || PHONE_CODE_SECONDS };
    }),
  );
  // input = keys typed on the lock screen (new PC or damaged vault); none = the saved ones.
  handle("cloud:list", (input) => attempt(async () => ({ snapshots: await cloud.list(input ?? undefined) })));
}

module.exports = { register };
