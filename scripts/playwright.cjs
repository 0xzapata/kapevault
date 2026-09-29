// The one place scripts load Playwright from. Playwright is not a dependency of this repo (the
// app never needs it), so: PLAYWRIGHT_PATH if set (a folder or file that `require` accepts),
// else `require("playwright")` resolved from the working folder, then from here up the parent folders
// (so a copy installed in mobile/ is found when a mobile script runs there).
// ESM scripts load it through createRequire(import.meta.url)("../playwright.cjs").
"use strict";

function loadPlaywright() {
  const override = process.env.PLAYWRIGHT_PATH;
  if (override) return require(override);
  let found;
  try {
    found = require.resolve("playwright", { paths: [process.cwd(), __dirname] });
  } catch {
    throw new Error(
      "Playwright not found. Install Playwright (npm i -D playwright, then npx playwright install chromium) " +
        "or set PLAYWRIGHT_PATH to an existing playwright package folder.",
    );
  }
  return require(found);
}

module.exports = loadPlaywright();
