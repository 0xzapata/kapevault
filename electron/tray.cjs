// The tray (Windows) / menu-bar (Mac) icon: open, quick search, lock, quit - and a tooltip that
// never names an account.
const path = require("node:path");
const { Menu, nativeImage, Tray } = require("electron");

const TRAY_TIP_MS = 60 * 60 * 1000; // a follow-up day can arrive while nothing in the vault changes
const trayImage = (name) => nativeImage.createFromPath(path.join(__dirname, "..", "build", name));

function createTrayIcon({ vault, settings, isMac, hotkey, showMain, showQuick, lockVault }) {
  let tray = null;

  function updateMenu() {
    if (!tray) return;
    const open = vault.status().unlocked;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open KAPEVault", click: showMain },
        { label: "Quick search", accelerator: hotkey, registerAccelerator: false, click: showQuick },
        { type: "separator" },
        { label: open ? "Lock vault" : "Locked", enabled: open, click: () => lockVault() },
        { type: "separator" },
        { label: "Quit KAPEVault", role: "quit" },
      ]),
    );
  }

  // Blind Reminders: the tray is outside the unlocked window, so it says only how many deletion
  // requests need a follow-up, never which. Locked, it keeps the last count (the vault cannot be read).
  function updateTip() {
    if (!tray || !vault.status().unlocked) return;
    const followUps = vault.followUpsDue();
    tray.setToolTip(followUps ? `KAPEVault - ${followUps} ${followUps === 1 ? "account" : "accounts"} to follow up` : "KAPEVault");
  }

  function create() {
    let image = isMac ? trayImage("trayTemplate.png") : trayImage("tray.png");
    if (image.isEmpty()) image = trayImage("icon.png").resize({ width: 16, height: 16 });
    if (isMac) image.setTemplateImage(true);
    tray = new Tray(image);
    tray.setToolTip("KAPEVault");
    setInterval(updateTip, TRAY_TIP_MS);
    if (!isMac) tray.on("click", showMain); // on a Mac a click opens the menu, as menu-bar items do
    updateMenu();
  }

  // The first time a close only hides KAPEVault to the tray, the tray says so. It runs inside the
  // window's close handler, so a settings write the disk refuses must not throw.
  function hintOnce() {
    if (!settings.get().trayHintShown && tray && !isMac) {
      tray.displayBalloon({ title: "KAPEVault is still running", content: "It is locked and waiting in the tray. Press Ctrl+Shift+Space to search from anywhere.", iconType: "info" });
      try {
        settings.set({ trayHintShown: true });
      } catch {
        // settings.json keeps what it had; the hint may show again next run
      }
    }
  }

  const destroy = () => tray?.destroy();

  return { create, updateMenu, updateTip, hintOnce, destroy };
}

module.exports = { createTrayIcon };
