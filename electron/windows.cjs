// KAPEVault's two windows: the vault window (frameless, resizable, its size and place remembered) and
// the quick search popup. Both are locked down the same way and load the same page.
const path = require("node:path");
const { app, BrowserWindow, Menu, screen } = require("electron");
const { cleanUp: cleanUpCourier } = require("./courier.cjs");
const { APP_ORIGIN } = require("./app-protocol.cjs");

const MIN_SIZE = { width: 400, height: 560 }; // the narrowest layout is a single column
const DEFAULT_SIZE = { width: 1440, height: 900 };
// The Windows caption buttons over the page's own 52px top bar, drawn light or dark with the theme.
const titleBarOverlay = (theme) => ({ color: "#00000000", symbolColor: theme === "dark" ? "#f5f5f7" : "#1d1d1f", height: 52 });

// isQuitting / biometricPrompting: main's state, read when a window event needs it. onCloseToTray:
// the vault window was closed with quick search on and is now hidden.
function createWindows({ settings, devEnv, isMac, resolvedTheme, isQuitting, biometricPrompting, onCloseToTray }) {
  let win = null;
  let quickWin = null;

  const all = () => [win, quickWin].filter((w) => w && !w.isDestroyed());

  // The window reopens where and how big it was left, as long as that is still on a screen.
  function initialBounds() {
    const saved = settings.windowBounds();
    if (saved) {
      const visible = screen.getAllDisplays().some(({ workArea: a }) => saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 && saved.y >= a.y - 20 && saved.y < a.y + a.height - 80);
      if (visible) return saved;
    }
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(DEFAULT_SIZE.width, Math.round(workArea.width * 0.92));
    const height = Math.min(DEFAULT_SIZE.height, Math.round(workArea.height * 0.92));
    return { width, height, maximized: false };
  }

  // Runs from a timer and from the close handler, where a throw would crash main with Electron's error
  // dialog. A write the disk refuses (antivirus: EPERM, EBUSY) leaves settings.json as it was.
  function rememberBounds() {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    try {
      settings.saveWindowBounds({ ...win.getNormalBounds(), maximized: win.isMaximized() });
    } catch {
      // the last saved size and place stay; the next move tries again
    }
  }

  const secureWebPreferences = () => ({
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: !app.isPackaged, // a packaged build opens no inspector on an unlocked vault
  });

  // Kept out of every screen capture (Recall, screenshots, recordings, screen sharing, taskbar and
  // Alt-Tab previews) - the phone's FLAG_SECURE - unless Settings turned "Hide from screen capture" off.
  // KAPEVAULT_ALLOW_CAPTURE: an unpacked `npm run design` run, which judges the glass from real-screen captures.
  const hideFromCapture = () => settings.get().hideFromCapture && !devEnv.KAPEVAULT_ALLOW_CAPTURE;

  // Each window only ever shows KAPEVault itself.
  function lockDown(w) {
    w.setContentProtection(hideFromCapture());
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  // The "Hide from screen capture" switch, applied to the open windows.
  function protectFromCapture() {
    for (const w of all()) w.setContentProtection(hideFromCapture());
  }

  // The theme rides in the query so the first paint is already in it; changes arrive as app:theme.
  function loadPage(w, hash) {
    const query = { theme: resolvedTheme() };
    const page = devEnv.KAPEVAULT_DEV_URL || `${APP_ORIGIN}/`;
    w.loadURL(`${page}?${new URLSearchParams(query)}${hash ? `#${hash}` : ""}`);
  }

  // A theme change: the Windows caption buttons follow it, and both pages redraw.
  function setTheme(theme) {
    if (!isMac && win && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay(theme));
    for (const w of all()) w.webContents.send("app:theme", theme);
  }

  function createWindow({ show = true } = {}) {
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
    const bounds = initialBounds();
    win = new BrowserWindow({
      ...bounds,
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      show: false,
      title: "KAPEVault",
      icon: isMac ? undefined : path.join(__dirname, "..", "build", "icon.ico"), // window + taskbar; `npm run icon` regenerates it
      // Frameless, macOS-style unified chrome: the page draws its own top bar (drag region). Windows
      // draws only its caption buttons over the right of it, macOS its traffic lights on the left.
      ...(isMac
        ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 }, vibrancy: "sidebar", visualEffectState: "followWindow", backgroundColor: "#00000000" }
        : { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay(resolvedTheme()), backgroundColor: "#00000000", backgroundMaterial: "acrylic" }),
      webPreferences: secureWebPreferences(),
    });
    if (bounds.maximized) win.maximize(); // no saved x/y = Electron centres it
    lockDown(win);

    let saveTimer = null;
    const saveSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(rememberBounds, 400);
    };
    for (const e of /** @type {const} */ (["resize", "move", "maximize", "unmaximize"])) /** @type {any} */ (win).on(e, saveSoon);
    // The title bar leaves room for the Mac traffic lights only outside full screen (TitleBar.tsx).
    const sendWindowState = () => win?.webContents.send("window:state", { maximized: win.isMaximized(), fullScreen: win.isFullScreen() });
    win.webContents.on("did-finish-load", sendWindowState);
    for (const e of /** @type {const} */ (["enter-full-screen", "leave-full-screen", "maximize", "unmaximize"])) /** @type {any} */ (win).on(e, sendWindowState);

    // With quick search on, closing hides KAPEVault to the tray (locked) instead of quitting.
    win.on("close", (e) => {
      rememberBounds();
      if (isQuitting() || !settings.get().quickSearch) return;
      e.preventDefault();
      win.hide();
      onCloseToTray();
    });
    win.on("closed", () => {
      win = null;
      if (!isQuitting()) app.quit();
    });
    // A Windows shut down, restart or sign-out never quits the app: no before-quit and no 'quit', so
    // not the process 'exit' the courier cleans up on either (Electron emits it from 'quit'). Windows
    // ends the process right after this event, so only synchronous work fits: stop a running curl and
    // delete its temp files. A backup still owed stays marked and goes up on the next unlock.
    win.on("session-end", () => cleanUpCourier());

    win.once("ready-to-show", () => {
      if (show) win.show();
    });
    loadPage(win);
  }

  function showMain() {
    if (!win) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }

  function createQuickWindow() {
    quickWin = new BrowserWindow({
      width: 680,
      height: 468,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "KAPEVault Quick Search",
      ...(isMac ? { type: "panel", vibrancy: "popover", visualEffectState: "active", backgroundColor: "#00000000" } : { backgroundColor: "#00000000", backgroundMaterial: "acrylic", roundedCorners: true }),
      webPreferences: secureWebPreferences(),
    });
    if (isMac) quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    lockDown(quickWin);
    // Spotlight rules: it goes away as soon as you click anywhere else.
    quickWin.on("blur", () => {
      if (!quickWin.webContents.isDevToolsOpened() && !biometricPrompting()) quickWin.hide();
    });
    // Every way it hides (blur, Escape, a copy, the hotkey) tells the page, which drops a half-typed
    // master password: nothing is kept in a hidden window.
    quickWin.on("hide", () => quickWin.webContents.send("quick:hidden"));
    quickWin.on("closed", () => {
      quickWin = null;
    });
    loadPage(quickWin, "quick");
  }

  // Centred high on the screen the pointer is on, like Spotlight.
  function showQuick() {
    if (!quickWin) createQuickWindow();
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [w] = quickWin.getSize();
    quickWin.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.18));
    const reveal = () => {
      quickWin.show();
      quickWin.focus();
      quickWin.webContents.send("quick:shown");
    };
    if (quickWin.webContents.isLoading()) quickWin.webContents.once("did-finish-load", reveal);
    else reveal();
  }

  function toggleQuick() {
    if (quickWin?.isVisible()) quickWin.hide();
    else showQuick();
  }

  return { all, main: () => win, quick: () => quickWin, createWindow, showMain, showQuick, toggleQuick, setTheme, protectFromCapture };
}

module.exports = { createWindows };
