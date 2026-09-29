// Backups and printouts: an encrypted copy, the Forever Opener, the Emergency Kit, Hand back, the
// grab list, and the folder copy.
const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");
const { setupCode } = require("../cloud-backup.cjs");
const { encodeQr } = require("../qr-encode.cjs");
const { kitHtml } = require("../emergency-kit.cjs");
const { savePdfWithDialog } = require("../pdf-export.cjs");
const { handBackHtml, HAND_BACK_MARGIN_IN } = require("../hand-back.cjs");
const { evacuationHtml, EVACUATION_MARGIN_IN } = require("../evacuation.cjs");
const { openerHtml, openerSha256, OPENER_NAME } = require("../opener.cjs");
const { copyVaultWithOpener } = require("../folder-copy.cjs");
const { writeFileAtomic } = require("../atomic-write.cjs");

function register({ handle, attempt, requireUnlocked, vault, folderCopy, windows }) {
  // A printout: the save dialog, the PDF, then the PDF viewer (pdf-export.cjs).
  const printPdf = (options) => savePdfWithDialog({ BrowserWindow, dialog, shell, parent: windows.main() }, options);

  // Local backup: the encrypted vault file exactly as on disk, somewhere the user picks (USB, Drive).
  handle("backup:saveCopy", () =>
    attempt(async () => {
      requireUnlocked();
      const { canceled, filePath } = await dialog.showSaveDialog(windows.main(), {
        title: "Save an encrypted copy of the vault",
        defaultPath: `KAPEVault backup ${new Date().toLocaleDateString("en-CA")}.kapevault`,
        filters: [{ name: "KAPEVault vault", extensions: ["kapevault"] }],
        properties: ["dontAddToRecent"],
      });
      if (canceled || !filePath) return { canceled: true };
      // The Forever Opener goes beside it, so the copy opens even where KAPEVault is not installed.
      const opener = copyVaultWithOpener(vault.status().path, filePath, app.getVersion());
      return { name: path.basename(filePath), opener };
    }),
  );

  // The Forever Opener on its own: one HTML page that opens a vault file in any browser. No vault data.
  handle("backup:saveOpener", () =>
    attempt(async () => {
      const { canceled, filePath } = await dialog.showSaveDialog(windows.main(), {
        title: "Save the Forever Opener",
        defaultPath: OPENER_NAME,
        filters: [{ name: "Web page", extensions: ["html"] }],
        properties: ["dontAddToRecent"],
      });
      if (canceled || !filePath) return { canceled: true };
      // Only a web page name, so a mistyped name can never replace a vault file (there is no .bak).
      if (!/\.html?$/i.test(filePath)) throw new Error("Save the opener as an .html file.");
      writeFileAtomic(filePath, openerHtml(app.getVersion())); // like every copy of it, never half-written
      return { name: path.basename(filePath) };
    }),
  );
  // Not a secret: the page's fingerprint, so a user can check an Opener file is the real one.
  handle("backup:openerHash", () => openerSha256(app.getVersion()));

  handle("backup:emergencyKit", (includeKeys) =>
    attempt(() => {
      const view = vault.publicView();
      const keys = includeKeys === true; // the secret, and the QR code that carries it, only when ticked
      const html = () => {
        const c = vault.cloudConfig();
        return kitHtml({
          createdAt: new Date(),
          vaultPath: vault.status().path,
          itemCount: view.entries.length,
          appVersion: app.getVersion(),
          openerSha256: openerSha256(app.getVersion()),
          cloud: c ? { url: `${c.endpoint}/${c.bucket}`, accessKeyId: c.accessKeyId, secretAccessKey: keys ? c.secretAccessKey : undefined, qr: keys ? encodeQr(setupCode(c)) : undefined } : null,
        });
      };
      return printPdf({ title: "Save your Emergency Kit", defaultPath: "KAPEVault Emergency Kit.pdf", html });
    }),
  );

  // "Hand back": a PDF of the items kept for one person. Passwords go in only when withSecrets is
  // exactly true (the tick box); main looks the items up itself, the page only names the person.
  handle("vault:handBack", (person, withSecrets) =>
    attempt(() => {
      const secrets = withSecrets === true;
      const { person: name, items } = vault.handBack(String(person), secrets);
      return printPdf({
        title: `Hand back to ${name}`,
        defaultPath: `For ${name.replace(/[\\/:*?"<>|]/g, "")}.pdf`,
        html: () => handBackHtml({ person: name, createdAt: new Date(), items, withSecrets: secrets }),
        margin: HAND_BACK_MARGIN_IN,
      });
    }),
  );

  // "Evacuate > Print": the grab list as a PDF. Main reads the things itself; the page only asks.
  handle("vault:evacuationPdf", () =>
    attempt(() => {
      const things = vault.publicView().entries.filter((e) => e.kind === "thing");
      return printPdf({ title: "Save the grab list", defaultPath: "Grab list.pdf", html: () => evacuationHtml({ createdAt: new Date(), things }), margin: EVACUATION_MARGIN_IN });
    }),
  );

  // Keep a copy in a folder: the folder is picked in main's own dialog (the page never names a path).
  handle("backup:folderStatus", () => folderCopy.status());
  handle("backup:chooseFolder", () =>
    attempt(async () => {
      requireUnlocked();
      const { canceled, filePaths } = await dialog.showOpenDialog(windows.main(), { title: "Keep a copy of the vault in this folder", properties: ["openDirectory", "createDirectory", "dontAddToRecent"] });
      if (canceled || !filePaths[0]) return { canceled: true };
      return { status: folderCopy.choose(filePaths[0]) };
    }),
  );
  handle("backup:stopFolder", () =>
    attempt(() => {
      requireUnlocked();
      return { status: folderCopy.stop() };
    }),
  );
}

module.exports = { register };
