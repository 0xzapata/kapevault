// The vault itself: status, create / unlock / lock, items and their secrets, copying, opening an
// item, the master password, 2FA scans, import, and Scan a label.
const { desktopCapturer, dialog, screen, shell } = require("electron");
const { ratePassword, parseTotp, parseLabel } = require("../../core/index.js");
const { revealTarget, isNetworkPath } = require("../file-access.cjs");
const { scanScreens } = require("../qr-scan.cjs");
const { readLabelText } = require("../label-ocr.cjs");
const { importPicked } = require("../import-file.cjs");

const SECRET_FIELDS = ["password", "body", "secret", "history", "code", "answer", "adminPassword", "wifiPassword", "photo", "idNumber"];
const secretArgs = (id, field, index) => {
  if (!SECRET_FIELDS.includes(field)) throw new Error("Unknown field");
  return [String(id), field, Number(index) || 0];
};

function register({ handle, attempt, requireUnlocked, vault, biometric, sync, clip, changed, unlocked, lockVault, throttledUnlock, setLastMasterAt, biometricKeyChanged, vaultStatus, windows, isMac, devEnv }) {
  // "Recently used" - a use never fails the action it is attached to.
  function used(id) {
    if (!id) return;
    try {
      changed(vault.touch(String(id)));
    } catch {
      // locked mid-action or the item is gone
    }
  }

  // Opens an item's own link - looked up in main by id, never a string from the page. Websites open
  // in the browser (http/https only). A local path is only ever revealed (`revealTarget`): a folder
  // opens in Explorer / Finder at its first item, a file or a Mac bundle is shown in its parent.
  async function openItem(id) {
    const { kind, target } = vault.openTarget(id);
    if (kind === "url") {
      let url;
      try {
        url = new URL(target);
      } catch {
        throw new Error("That is not a web address");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web links open from KAPEVault");
      await shell.openExternal(url.href);
      return;
    }
    // A network folder link: Explorer contacts the share on this click, main never touches it first
    // (a disk call would offer the NTLM hash from main and block it ~20s when nothing answers).
    if (isNetworkPath(target)) return shell.showItemInFolder(target);
    let reveal;
    try {
      reveal = revealTarget(target);
    } catch {
      throw new Error(`That path does not exist on this ${isMac ? "Mac" : "PC"}`);
    }
    shell.showItemInFolder(reveal);
  }

  handle("vault:status", () => vaultStatus());
  handle("vault:view", () => (vault.status().unlocked ? vault.publicView() : null));

  handle("vault:create", async (master) => {
    const result = await vault.create(String(master));
    if (result.ok) setLastMasterAt(Date.now());
    return unlocked(result);
  });
  // Nothing between opening the session and unlocked() may throw: the page would show an error while
  // main sits unlocked with no session limit, tray or backup. touchMaster never throws (a re-seal the
  // disk refuses leaves the Hello / Touch ID record as it was).
  handle("vault:unlock", async (master) => {
    const result = await throttledUnlock(() => vault.unlock(String(master)));
    if (result.ok) {
      setLastMasterAt(Date.now());
      const key = vault.keyCopy(); // seals the Hello / Touch ID dates to this vault
      biometric.touchMaster(key);
      key.fill(0);
    }
    return unlocked(result);
  });
  handle("vault:lock", () => lockVault());
  handle("vault:saveEntry", (input) => {
    const result = vault.saveEntry(input);
    changed(result.vault);
    return result;
  });
  // Delete = move to the Trash (restore, delete now and empty are the Trash view's).
  handle("vault:deleteEntry", (id) => changed(vault.deleteEntry(String(id))));
  handle("vault:restoreEntry", (id) => changed(vault.restoreEntry(String(id))));
  handle("vault:deleteForever", (id) => changed(vault.deleteForever(String(id))));
  handle("vault:emptyTrash", () => changed(vault.emptyTrash()));
  handle("vault:toggleFavorite", (id) => changed(vault.toggleFavorite(String(id))));
  // Backup codes: the codes come to the page only through vault:recoveryCodes (reveal) and
  // copySecret(id, "code", index); everything else sends counts.
  handle("vault:recoveryCodes", (id) => vault.getRecoveryCodes(String(id)));
  handle("vault:setRecoveryCodes", (id, codes) => changed(vault.setRecoveryCodes(String(id), codes)));
  handle("vault:markRecoveryCode", (id, index, used) => changed(vault.markRecoveryCode(String(id), Number(index), used === true)));
  handle("vault:addPaperCopy", (id, where, printedAt) => changed(vault.addPaperCopy(String(id), String(where ?? ""), String(printedAt ?? ""))));
  handle("vault:removePaperCopy", (id, index) => changed(vault.removePaperCopy(String(id), Number(index))));
  // Shrink Queue: closing an account, then wiping it to a tombstone.
  handle("vault:setLifecycle", (id, state) => changed(vault.setLifecycle(String(id), state))); // state is checked in the session
  handle("vault:confirmGone", (id, clearNotes) => changed(vault.confirmGone(String(id), clearNotes === true)));
  handle("vault:moveEntry", (id, spaceId) => changed(vault.moveEntry(String(id), String(spaceId))));
  handle("vault:addSpace", (name) => {
    const result = vault.addSpace(String(name));
    changed(result.vault);
    return result;
  });
  handle("vault:renameSpace", (id, name) => changed(vault.renameSpace(String(id), String(name))));
  handle("vault:setSpacePhoto", (id, photo) => changed(vault.setSpacePhoto(String(id), String(photo))));
  handle("vault:deleteSpace", (id, moveToId) => changed(vault.deleteSpace(String(id), moveToId ? String(moveToId) : null)));
  handle("vault:clearHistory", (id) => changed(vault.clearHistory(String(id))));
  // Generated passwords: the page sends a value once, as it leaves the generator (main checks it), and
  // gets the times back; one value comes out by its place in that list, like a login's old passwords.
  handle("vault:recordGenerated", (value) => vault.recordGenerated(value));
  handle("vault:generatedList", () => vault.generatedList());
  handle("vault:getGenerated", (index) => vault.getGenerated(Number(index)));
  handle("vault:copyGenerated", async (index) => {
    const value = vault.getGenerated(Number(index));
    if (!value) throw new Error("Nothing to copy");
    await clip.copyWithAutoClear(value);
  });
  handle("vault:clearGenerated", () => vault.clearGenerated());
  handle("vault:getPassword", (id) => vault.getPassword(String(id)));
  handle("vault:copyPassword", async (id) => {
    await clip.copyWithAutoClear(vault.getPassword(String(id)));
    used(id);
  });
  handle("vault:getSecret", (id, field, index) => vault.getSecret(...secretArgs(id, field, index)));
  handle("vault:copySecret", async (id, field, index) => {
    if (field === "photo") throw new Error("A photo is not copied");
    await clip.copyWithAutoClear(vault.getSecret(...secretArgs(id, field, index)));
    used(id);
  });
  handle("vault:totp", (id) => vault.getTotpCode(String(id)));
  handle("vault:copyTotp", async (id) => {
    const { code } = vault.getTotpCode(String(id));
    await clip.copyWithAutoClear(code);
    used(id);
    return code;
  });
  // Validates a typed or scanned 2FA key for the form; nothing is stored until the item is saved.
  handle("vault:parseTotp", (input) =>
    attempt(() => {
      const { uri, issuer, account } = parseTotp(String(input));
      return { uri, issuer, account };
    }),
  );
  handle("vault:ratePassword", (password) => {
    const { score, label } = ratePassword(String(password));
    return { score, label };
  });
  handle("vault:copyText", async (text, id) => {
    requireUnlocked();
    // Usernames, account numbers, serials: identifiers clear like a password, so a bank number does not stay on the clipboard.
    await clip.copyWithAutoClear(String(text));
    used(id);
  });
  handle("vault:openEntry", async (id) => {
    await openItem(String(id));
    used(id);
  });
  // Never alongside a sync or a restore (sync.exclusive, outside the throttle: a refusal is not a guess).
  handle("vault:changeMaster", (current, next) => sync.exclusive("master", () => changeMaster(current, next)));
  async function changeMaster(current, next) {
    const result = await throttledUnlock(() => vault.changeMaster(String(current), String(next))); // it tests the current password
    if (result.ok) {
      setLastMasterAt(Date.now());
      changed(vault.publicView()); // the page drops the "master is easy to guess" issue
    }
    if (result.ok && biometric.status().enabled) {
      await biometricKeyChanged();
      return { ...result, biometricOff: true };
    }
    return result;
  }
  handle("vault:revealFile", () => {
    requireUnlocked();
    shell.showItemInFolder(vault.status().path);
  });

  // Scan a 2FA QR code shown on screen. KAPEVault goes see-through for the capture so it never
  // covers the code; the key comes back to the form, which saves it like a typed one.
  handle("vault:scanQr", async () => {
    requireUnlocked();
    const shown = windows.all().filter((w) => w.isVisible());
    for (const w of shown) w.setOpacity(0);
    let found = [];
    try {
      await new Promise((r) => setTimeout(r, 180)); // let the compositor drop the window first
      found = await scanScreens({ desktopCapturer, screen });
    } catch {
      found = [];
    } finally {
      for (const w of shown) if (!w.isDestroyed()) w.setOpacity(1);
    }
    if (found.length === 0) return { ok: false, error: "No QR code found on screen. Show the whole code, then scan again." };
    const setup = found.find((t) => /^otpauth:\/\/totp\//i.test(t));
    if (!setup) return { ok: false, error: found.some((t) => /^otpauth/i.test(t)) ? "That QR code type is not supported. Use the setup key instead." : "That QR code is not a 2FA setup code." };
    return attempt(() => {
      const { uri, issuer, account } = parseTotp(setup);
      return { uri, issuer, account };
    });
  });

  // Import: the file is picked in a native dialog (the page never names a path), added in one
  // all-or-nothing write, then deleted when every row is accounted for (import-file.cjs importPicked).
  handle("vault:import", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windows.main(), {
      title: "Import into KAPEVault",
      filters: [{ name: "Password export or KAPEVault import", extensions: ["json", "csv"] }],
      properties: ["openFile", "dontAddToRecent"],
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    const result = importPicked(filePaths[0], vault);
    if (result.ok) changed(result.vault);
    return result;
  });

  // "Scan a label": Windows reads the sticker photo offline and main turns the text into suggested
  // fields. Nothing is saved here - the form shows them for the user to check.
  handle("device:readLabel", (image) =>
    attempt(async () => {
      requireUnlocked();
      const read = await readLabelText(image, { fake: devEnv.KAPEVAULT_OCR_FAKE });
      return read.status === "ok" ? { reader: "ok", found: parseLabel(read.text) } : { reader: "unavailable", found: {} };
    }),
  );
}

module.exports = { register };
