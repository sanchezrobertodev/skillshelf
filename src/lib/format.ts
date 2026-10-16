import type { Item, Kind, Source, Status } from "../types";

export const kindLabel: Record<Kind, string> = { plugin: "Plugin", skill: "Skill" };

export const sourceLabel: Record<Source, string> = {
  marketplace: "Marketplace",
  synced: "Org synced",
  skillsCli: "skills CLI",
  local: "Local",
  project: "Project",
};

export const sourceHelp: Record<Source, string> = {
  marketplace: "Installed with claude plugin install",
  synced: "Pushed by your claude.ai organization",
  skillsCli: "Installed with the skills CLI (npx skills)",
  local: "A folder in ~/.claude/skills no installer tracks",
  project: "A skill in a project's .claude/skills folder",
};

export const statusLabel: Record<Status, string> = {
  updateAvailable: "Update available",
  error: "Check failed",
  unknown: "Unknown",
  unchecked: "Not checked",
  upToDate: "Up to date",
  managed: "Managed",
  untracked: "Untracked",
};

export const statusOrder: Record<Status, number> = {
  updateAvailable: 0,
  error: 1,
  unknown: 2,
  unchecked: 3,
  upToDate: 4,
  managed: 5,
  untracked: 6,
};

export function relativeTime(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

export function canUpdate(i: Item) {
  return i.source === "marketplace" || i.source === "skillsCli";
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
      return "Runs claude plugin uninstall. The plugin's saved data folder is removed too.";
    case "skillsCli":
      return "Unlinks it from Claude Code with the skills CLI. Other agents that share it keep their copy.";
    case "local":
    case "project":
      return "Moves the skill folder to the trash, so you can restore it.";
    default:
      return "Not supported.";
  }
}
