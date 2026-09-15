/**
 * Bundle budget: fails the build when the entry chunk or the eagerly loaded JS of the map route grow too much.
 * Budgets (raw bytes): entry ≤ 500 kB; sum of scripts referenced by dist/index.html (modulepreload + entry) ≤ 6 MB.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const html = await readFile(path.join(dist, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
const entry = refs.find((r) => /assets\/index-[^/]+\.js$/.test(r));
const ENTRY_MAX = 500 * 1024;
const EAGER_MAX = 6 * 1024 * 1024;

let eager = 0;
for (const r of new Set(refs)) {
  const file = path.join(dist, r.replace(/^\/?[^/]*\//, (m) => (m.startsWith("/") ? "" : m)).replace(/^\//, ""));
  try {
    eager += (await stat(file)).size;
  } catch {
    /* external or base-prefixed path: try stripping the base */
    const alt = path.join(dist, r.split("/assets/")[1] ? "assets/" + r.split("/assets/")[1] : r);
    eager += (await stat(alt)).size;
  }
}
const entryFile = entry ? path.join(dist, "assets", path.basename(entry)) : null;
const entrySize = entryFile ? (await stat(entryFile)).size : 0;
const kb = (n) => (n / 1024).toFixed(0) + " kB";
console.log(`entry ${kb(entrySize)} (max ${kb(ENTRY_MAX)}), eager JS ${kb(eager)} (max ${kb(EAGER_MAX)}), ${refs.length} script refs`);
let failed = false;
if (entrySize > ENTRY_MAX) { console.error("Entry chunk over budget"); failed = true; }
if (eager > EAGER_MAX) { console.error("Eager JS over budget"); failed = true; }
process.exit(failed ? 1 : 0);
