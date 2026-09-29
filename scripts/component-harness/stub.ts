const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
(window as any).__saved = [];
(window as any).kapevault = {
  platform: "win32",
  getPassword: async (id: string) => {
    if (id === "locked") throw new Error("Error invoking remote method 'vault:getPassword': Error: Vault is locked");
    return "old-password-1";
  },
  getSecret: async (_id: string, field: string) => (field === "body" ? "stored note body" : "sk_live_stored"),
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
};
