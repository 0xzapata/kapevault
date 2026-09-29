// CommonJS: the Capacitor CLI require()s this file.
/** @type {import("@capacitor/cli").CapacitorConfig} */
module.exports = {
  appId: "com.brewedops.kapevault",
  appName: "KAPEVault",
  webDir: "dist",
  // No server.url and no allowNavigation: the app loads only its own bundled files, and any other
  // link opens in the phone's browser. (npm run sim:live adds a dev server url to the copied config
  // for that run only; a release build refuses it.) WebView debugging stays Capacitor's default:
  // debug builds only.
  android: {
    // Capacitor's debug logging prints every plugin call's arguments and results to logcat -
    // that would be the vault key and the master password.
    loggingBehavior: "none",
  },
  plugins: {
    // Edge to edge is MainActivity's: Capacitor's own insets handling pads the window (white strips) on
    // any WebView before 140, which is what this emulator image and many phones have.
    SystemBars: { insetsHandling: "disable" },
  },
};
