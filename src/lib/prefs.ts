// Per-viewer UI preferences. Storage can be unavailable, so every access is guarded.

import type { Kind, Source, Status } from "../types";

export type Theme = "system" | "light" | "dark";
export type SortKey = "name" | "kind" | "source" | "version" | "status" | "updated";

export interface Filters {
  kinds: Kind[];
  statuses: Status[];
  sources: Source[];
  origins: string[];
  enabled: "all" | "enabled" | "disabled";
}

export interface Prefs {
  theme: Theme;
  sort: { key: SortKey; desc: boolean };
  filters: Filters;
}

export const emptyFilters: Filters = { kinds: [], statuses: [], sources: [], origins: [], enabled: "all" };

const defaults: Prefs = {
  theme: "system",
  sort: { key: "status", desc: false },
  filters: emptyFilters,
};

const KEY = "skillshelf.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaults, ...p, filters: { ...emptyFilters, ...p.filters } };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function onSystemThemeChange(cb: () => void) {
  media?.addEventListener("change", cb);
  return () => media?.removeEventListener("change", cb);
}
