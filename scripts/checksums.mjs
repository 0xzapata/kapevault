// Last step of `npm run installer`: writes "<installer>.sha256" (<hex>  <filename>, the sha256sum format)
// beside the Windows installer electron-builder just made, in build.directories.output.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
const dir = pkg.build.directories.output.replace(/\$\{env\.(\w+)\}/g, (_, name) => process.env[name] ?? "");
const file = path.join(dir, `${pkg.build.productName} Setup ${pkg.version}.exe`);
if (!fs.existsSync(file)) {
  console.error(`checksums: no installer at ${file}`);
  process.exit(1);
}
const line = `${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}  ${path.basename(file)}\n`;
fs.writeFileSync(`${file}.sha256`, line);
console.log(`wrote ${file}.sha256: ${line.trim()}`);
