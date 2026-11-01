import { locale, t, type TKey } from "../i18n";
import type { Issue, Item, Kind, Risk, Source, Status } from "../types";

/** A record whose values are looked up in the current language each time they're read. */
function labels<K extends string>(keys: Record<K, TKey>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { get: () => t(keys[k]), enumerable: true });
  return out;
}

export const kindLabel = labels<Kind>({ plugin: "kind.plugin", skill: "kind.skill" });

export const sourceLabel = labels<Source>({
  marketplace: "source.marketplace",
  synced: "source.synced",
  skillsCli: "source.skillsCli",
  local: "source.local",
  project: "source.project",
});

export const sourceHelp = labels<Source>({
  marketplace: "sourceHelp.marketplace",
  synced: "sourceHelp.synced",
  skillsCli: "sourceHelp.skillsCli",
  local: "sourceHelp.local",
  project: "sourceHelp.project",
});

export const statusLabel = labels<Status>({
  updateAvailable: "status.updateAvailable",
  error: "status.error",
  unknown: "status.unknown",
  unchecked: "status.unchecked",
  upToDate: "status.upToDate",
  managed: "status.managed",
  untracked: "status.untracked",
  moved: "status.moved",
  removed: "status.removed",
});

export const statusOrder: Record<Status, number> = {
  updateAvailable: 0,
  error: 1,
  moved: 2,
  removed: 3,
  unknown: 4,
  unchecked: 5,
  upToDate: 6,
  managed: 7,
  untracked: 8,
};

export function relativeTime(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutes", { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hours", { count: h });
  const d = Math.round(h / 24);
  if (d < 30) return t("time.days", { count: d });
  const mo = Math.round(d / 30);
  if (mo < 12) return t("time.months", { count: mo });
  return t("time.years", { count: Math.round(mo / 12) });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleString(locale());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Moved and removed skills can't be updated in place: they're reinstalled from the new location or uninstalled. */
export function canUpdate(i: Item) {
  return (i.source === "marketplace" || i.source === "skillsCli") && i.status !== "moved" && i.status !== "removed";
}

export function canReinstall(i: Item) {
  return i.status === "moved" && i.source === "skillsCli";
}

export function canToggle(i: Item) {
  return i.kind === "plugin" && i.enabled !== null;
}

export function canUninstall(i: Item) {
  return i.source !== "synced";
}

export function uninstallEffect(i: Item): string {
  switch (i.source) {
    case "marketplace":
      return t("uninstall.marketplace");
    case "skillsCli":
      return t("uninstall.skillsCli");
    case "local":
    case "project":
      return t("uninstall.folder");
    default:
      return t("uninstall.unsupported");
  }
}

/** A health issue in the UI's language; the backend's English when a value it needs is missing. */
export function issueText(i: Issue): string {
  const text = t(`health.${i.code}`, i.params);
  return /\{\w+\}/.test(text) ? i.message : text;
}

/** Why a risk flag matters, plus the allowed tools an update adds or removes. */
export function riskText(r: Risk): string {
  const parts = [t(`risk.why.${r.kind}`)];
  if (r.added?.length) parts.push(t("risk.toolsAdded", { tools: r.added.join(", ") }));
  if (r.removed?.length) parts.push(t("risk.toolsRemoved", { tools: r.removed.join(", ") }));
  return parts.join(" ");
}
