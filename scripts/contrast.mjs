// Checks every text colour pair of every theme in src/index.css against WCAG contrast: 4.5:1,
// or 7:1 for the high-contrast theme. Run `node scripts/contrast.mjs`; exits 1 on a failure.

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

// Each `:root…{}` / `[data-palette…]{}` block is one theme: palette from data-palette (default workbench), mode from data-theme.
const themes = {};
for (const [, selector, body] of css.matchAll(/((?::root|\[data-palette)[^{]*)\{([^}]*)\}/g)) {
  const palette = selector.match(/data-palette="(\w+)"/)?.[1] ?? "workbench";
  const mode = selector.includes('data-theme="dark"') ? "dark" : "light";
  const vars = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
  const grad = body.match(/--accent-grad:([^;]*)/)?.[1].match(/#[0-9a-f]{6}/gi);
  if (grad) vars.grad = grad;
  // Merge like the cascade: rule blocks such as `[data-palette="workbench"] .card {}` add nothing here.
  const key = `${palette} ${mode}`;
  themes[key] = { ...themes[key], ...vars };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** `fg` at `alpha` over `bg`, like Tailwind's `bg-warn/12`. */
const tint = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

// [text, background, tint alpha of the text colour over the background, if any]
const pairs = [
  ...["bg", "surface", "surface-2", "surface-hover"].flatMap((b) => [
    ["fg", b],
    ["muted", b],
  ]),
  ...["accent", "warn", "danger", "info"].flatMap((c) => [
    [c, "surface"],
    [c, "bg"],
    [c, "surface", 0.12],
  ]),
  ["accent-fg", "accent"],
  ["accent-fg", "accent-hover"],
  ["warn-fg", "warn"],
  ["warn-fg", "warn-hover"],
  ["nav-active-fg", "nav-active"],
];

let failed = 0;
for (const [name, v] of Object.entries(themes)) {
  const min = name.startsWith("contrast") ? 7 : 4.5;
  for (const [fg, bg, alpha] of pairs) {
    if (!v[fg] || !v[bg]) {
      console.log(`${name}: missing --${v[fg] ? bg : fg}`);
      failed++;
      continue;
    }
    const back = alpha ? tint(rgb(v[fg]), rgb(v[bg]), alpha) : rgb(v[bg]);
    const r = ratio(rgb(v[fg]), back);
    if (r < min) {
      console.log(`${name}: ${fg} on ${bg}${alpha ? ` tint ${alpha * 100}%` : ""} is ${r.toFixed(2)}:1, needs ${min}:1`);
      failed++;
    }
  }
  // Gradient primary buttons: accent-fg on every stop and halfway between neighbouring stops.
  const stops = (v.grad ?? []).map(rgb);
  const points = stops.flatMap((s, i) => (i ? [tint(stops[i - 1], s, 0.5), s] : [s]));
  for (const p of points) {
    const r = ratio(rgb(v["accent-fg"]), p);
    if (r < min) {
      console.log(`${name}: accent-fg on gradient rgb(${p}) is ${r.toFixed(2)}:1, needs ${min}:1`);
      failed++;
    }
  }
}
console.log(failed ? `${failed} pair(s) fail.` : `All ${Object.keys(themes).length} themes pass.`);
process.exit(failed ? 1 : 0);
