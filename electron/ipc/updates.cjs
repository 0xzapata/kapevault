// The update check (updates.cjs): the page asks, main answers { available, version, checkedAt, error? }.
// The page never names an address and never makes the request.
// openExternal: shell.openExternal, passed in so a test can stand in for it.
function register({ handle, updates, openExternal }) {
  handle("updates:status", () => updates.status());
  // Switching the setting on asks at once (when due); the answer comes back for the Settings line.
  handle("updates:check", () => updates.checkIfDue());
  handle("updates:open", async () => {
    const page = updates.pageToOpen();
    if (page) await openExternal(page);
  });
}

module.exports = { register };
