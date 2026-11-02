// Checks every language file in src/i18n against en.json: same keys, and the same {placeholders} in
// each text, so a translation never drops a value the UI fills in. Exits 1 on any mismatch.
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../src/i18n/", import.meta.url);
const load = (file) => JSON.parse(readFileSync(new URL(file, dir), "utf8"));
const holes = (text) => [...new Set(text.match(/\{\w+\}/g))].sort().join(" ");
const PLURAL = /_(zero|two|few|many)$/;

const en = load("en.json");
let failed = 0;
const fail = (msg) => (console.log(msg), failed++);

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  const t = load(file);
  for (const [key, text] of Object.entries(en)) {
    if (!(key in t)) fail(`${file}: missing ${key}`);
    else if (holes(t[key]) !== holes(text)) fail(`${file}: ${key} has "${holes(t[key])}", en.json has "${holes(text)}"`);
  }
  // Plural forms English doesn't have (CONTRIBUTING.md) are allowed when en.json has the key's _other form.
  for (const key of Object.keys(t)) {
    if (key in en) continue;
    const other = PLURAL.test(key) ? key.replace(PLURAL, "_other") : null;
    if (!(other in en)) fail(`${file}: ${key} is not in en.json`);
    else if (holes(t[key]) !== holes(en[other])) fail(`${file}: ${key} has "${holes(t[key])}", en.json ${other} has "${holes(en[other])}"`);
  }
}

console.log(failed ? `${failed} problem(s).` : "All languages match en.json.");
process.exit(failed ? 1 : 0);
