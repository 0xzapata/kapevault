// A vault, backup or snapshot a newer KAPEVault saved is neither a wrong password nor damaged: it says to
// update, and the unlock throttle does not count it (core nextThrottle). Nothing is written for it.
const core = require("../core/index.js");

const newerResult = () => ({ ok: false, newer: true, error: new core.NewerVaultError().message });
const isNewer = (e) => e instanceof core.NewerVaultError;

module.exports = { newerResult, isNewer };
