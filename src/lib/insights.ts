import type { Item, Usage } from "../types";

/** On, and not tied to one project, so it loads in every session. */
export const loadsEverywhere = (i: Item) => i.enabled !== false && i.scope !== "project" && i.scope !== "local";

/** Estimated tokens every session starts with, from everything that's on. */
export function sessionTokens(items: Item[]): number {
  return items.filter(loadsEverywhere).reduce((n, i) => n + (i.cost?.total ?? 0), 0);
}

/** Hooks work without showing up in transcripts. */
export const hasHooks = (i: Item) => i.children.some((c) => c.kind === "hook");

/**
 * An enabled plugin with no uses in 30 days. Plugins with hooks and mods work without leaving a
 * trace in transcripts, so they're never called unused.
 */
export function isUnused(i: Item, usage: Record<string, Usage> | null): boolean {
  const u = usage?.[i.id];
  return !!u && i.kind === "plugin" && i.enabled !== false && !hasHooks(i) && !i.isMod && u.uses === 0;
}

/** 53271 → "53k". */
export function shortCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
