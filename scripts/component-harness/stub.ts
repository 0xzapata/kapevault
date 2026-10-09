const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
const generated: { value: string; at: string }[] = []; // the generator's Recent list, kept in main in the app
const generatedRows = () => generated.map(({ at }) => ({ at }));
(window as any).__saved = [];
(window as any).kapevault = {
  platform: "win32",
  getPassword: async (id: string) => {
    if (id === "locked") throw new Error("Error invoking remote method 'vault:getPassword': Error: Vault is locked");
    return "old-password-1";
  },
  getSecret: async (_id: string, field: string) => (field === "body" ? "stored note body" : "sk_live_stored"),
  generatedList: async () => generatedRows(),
  recordGenerated: async (value: string) => {
    if (!generated.some((g) => g.value === value)) generated.unshift({ value, at: new Date().toISOString() });
    return generatedRows();
  },
  getGenerated: async (index: number) => generated[index]?.value ?? "",
  copyGenerated: async () => {},
  copyText: async () => {},
  clearGenerated: async () => {
    generated.length = 0;
    return [];
  },
  ratePassword: async (pw: string) => {
    const score = Math.min(4, Math.floor(pw.length / 5));
    return { score, label: LABELS[score] };
  },
  parseTotp: async (s: string) =>
    /^(JBSW|otpauth)/.test(s) ? { ok: true, uri: "otpauth://totp/X", issuer: "GitHub", account: "me" } : { ok: false, error: "That is not a valid 2FA setup key." },
  scanQr: async () => {
    await sleep(300);
    return { ok: true, uri: "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub", issuer: "GitHub", account: "me" };
  },
  onWindowState: () => () => {},
  // The forms scenario counts these calls, so a double submit shows.
  unlock: async () => {
    (window as any).__submits.unlock = ((window as any).__submits.unlock ?? 0) + 1;
    return { ok: false, error: "Wrong password" };
  },
  unlockBiometric: async () => {
    (window as any).__submits.biometric = ((window as any).__submits.biometric ?? 0) + 1;
    return { ok: false, error: "Hello did not answer" };
  },
  biometricStatus: async () => ({ name: "Windows Hello", supported: true, enabled: true, needsMaster: false, stale: false }),
  onQuickHidden: () => () => {},
  cloudStatus: async () => ({ settings: null }),
  getSettings: async () => ({ sessionLimitHours: 0 }),
  changeMaster: async () => {
    (window as any).__submits.changeMaster = ((window as any).__submits.changeMaster ?? 0) + 1;
    return { ok: true };
  },
};
