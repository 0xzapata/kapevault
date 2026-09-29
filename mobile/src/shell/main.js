// The native shell check (shell.html, debug builds only): drives the native plugins by hand for
// scripts/proof.mjs. The vault itself is index.html.
// It never shows a key or a secret, only what happened.
import "./main.css";

const native = (plugin, method, options = {}) => window.Capacitor.nativePromise(plugin, method, options);
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

// A throwaway key per page load stands in for the vault key.
const testKey = base64(crypto.getRandomValues(new Uint8Array(32)));

const actions = {
  async status() {
    const { available, enabled, reason } = await native("VaultKeystore", "isAvailable");
    if (!available) return reason === "none-enrolled" ? "No fingerprint set up" : "Not available";
    return enabled ? "On" : "Off";
  },
  async enable() {
    await native("VaultKeystore", "enable", { key: testKey });
    return "On";
  },
  async unlock() {
    const { key } = await native("VaultKeystore", "unlock");
    return key === testKey ? "Same key back" : "A different key";
  },
  async disable() {
    await native("VaultKeystore", "disable");
    return "Off";
  },
  async copy() {
    await native("SecureClipboard", "copy", { text: "kapevault-test-secret" });
    return "Clears in 30 s";
  },
};

const resultOf = (name) => document.querySelector(`[data-result="${name}"]`);

document.addEventListener("click", async (event) => {
  const name = event.target.closest?.("[data-action]")?.dataset.action;
  const result = resultOf(name);
  if (!result) return;
  result.textContent = "...";
  try {
    result.textContent = await actions[name]();
  } catch (err) {
    result.textContent = err.code ? `${err.code}` : "Failed";
  }
});

// Counts each native lifecycle event on its row.
for (const name of ["background", "resume"]) {
  let count = 0;
  window.addEventListener(`kapevault:${name}`, () => {
    count += 1;
    const result = resultOf(name);
    if (result) result.textContent = `${count} ${count === 1 ? "time" : "times"}`;
  });
}
