import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// core/ runs in Electron main AND the phone's WebView, so it may only use what both have.
test("core uses no Node built-ins and imports nothing from outside core/", () => {
  const root = import.meta.dirname;
  const sources = fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /\brequire\(|\bBuffer\b|\bprocess\.|from "node:/, `${file} uses a Node API`);
    for (const [, from] of text.matchAll(/^(?:import|export)\b[^;]*?from "([^"]+)"/gm)) {
      const target = path.resolve(root, path.dirname(file), from);
      assert.ok(/^\.\.?\/[\w./-]+\.js$/.test(from) && target.startsWith(root + path.sep), `${file} imports ${from}`);
    }
  }
});
