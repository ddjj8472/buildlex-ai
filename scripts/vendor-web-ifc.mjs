// Copies the web-ifc WebAssembly binary next to the app so the browser worker can load it
// from /vendor/web-ifc/. Runs on `npm install` (postinstall) so the .wasm always matches
// the installed web-ifc JavaScript API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "node_modules", "web-ifc");
const dst = path.join(root, "public", "vendor", "web-ifc");
if (!fs.existsSync(path.join(src, "web-ifc.wasm"))) {
  console.warn("[vendor-web-ifc] web-ifc not installed — skipped");
  process.exit(0);
}
fs.mkdirSync(dst, { recursive: true });
for (const f of ["web-ifc.wasm", "LICENSE.md"]) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log("[vendor-web-ifc] copied web-ifc.wasm →", path.relative(root, dst));
