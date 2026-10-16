import type { Item } from "../types";
import { statusOrder } from "./format";
import type { Filters, SortKey } from "./prefs";

export type Facet = "kinds" | "statuses" | "sources" | "origins" | "enabled";

function matchesQuery(i: Item, q: string) {
  if (!q) return true;
  const hay = [i.name, i.description, i.origin, i.id, i.version, ...i.children.map((c) => c.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/** `except` skips one facet so the sidebar can show how many items each option would add. */
export function matches(i: Item, f: Filters, q: string, except?: Facet) {
  if (except !== "kinds" && f.kinds.length && !f.kinds.includes(i.kind)) return false;
  if (except !== "statuses" && f.statuses.length && !f.statuses.includes(i.status)) return false;
  if (except !== "sources" && f.sources.length && !f.sources.includes(i.source)) return false;
  if (except !== "origins" && f.origins.length && !f.origins.includes(i.origin ?? "")) return false;
  if (except !== "enabled" && f.enabled !== "all") {
    if (i.enabled === null) return false;
    if (f.enabled === "enabled" !== i.enabled) return false;
  }
  return matchesQuery(i, q);
}

export function countBy<T extends string>(items: Item[], key: (i: Item) => T | null) {
  const counts = new Map<T, number>();
  for (const i of items) {
    const k = key(i);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortItems(items: Item[], key: SortKey, desc: boolean) {
  const dir = desc ? -1 : 1;
  const byName = (a: Item, b: Item) => collator.compare(a.name, b.name);
  const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
    name: byName,
    kind: (a, b) => collator.compare(a.kind, b.kind),
    source: (a, b) => collator.compare(a.source, b.source) || collator.compare(a.origin ?? "", b.origin ?? ""),
    version: (a, b) => collator.compare(a.version ?? "", b.version ?? ""),
    status: (a, b) => statusOrder[a.status] - statusOrder[b.status],
    updated: (a, b) => (a.updatedAt ?? a.installedAt ?? "").localeCompare(b.updatedAt ?? b.installedAt ?? ""),
  };
  return [...items].sort((a, b) => cmp[key](a, b) * dir || byName(a, b));
}
