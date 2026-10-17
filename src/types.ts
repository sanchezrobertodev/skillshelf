// Mirrors src-tauri/src/model.rs and actions.rs.

export type Kind = "plugin" | "skill";
export type Source = "marketplace" | "synced" | "skillsCli" | "local" | "project";
export type Status = "unchecked" | "upToDate" | "updateAvailable" | "unknown" | "managed" | "untracked" | "error";

export interface Child {
  kind: "skill" | "command" | "agent" | "mcp" | "hook";
  name: string;
  description: string | null;
}

export interface Item {
  id: string;
  kind: Kind;
  source: Source;
  name: string;
  description: string | null;
  version: string | null;
  latest: string | null;
  status: Status;
  statusDetail: string | null;
  scope: string | null;
  enabled: boolean | null;
  path: string | null;
  repoUrl: string | null;
  origin: string | null;
  installedAt: string | null;
  updatedAt: string | null;
  children: Child[];
  notes: string[];
  meta: Record<string, string>;
}

export interface ScanResult {
  items: Item[];
  warnings: string[];
  scannedAt: number;
}

export interface CheckResult {
  items: Item[];
  warnings: string[];
  checkedAt: number;
}

export type Action = "update" | "enable" | "disable" | "uninstall";

export interface ActionRequest {
  itemId: string;
  action: Action;
  acceptCommand?: string;
}

export type JobState = "queued" | "running" | "log" | "success" | "failed" | "needsConfirmation";

export interface JobEvent {
  jobId: number;
  itemId: string;
  itemName: string;
  action: Action;
  state: JobState;
  line: string | null;
  message: string | null;
  confirm: { command: string; sha256: string } | null;
}

export interface Job {
  jobId: number;
  itemId: string;
  itemName: string;
  action: Action;
  state: Exclude<JobState, "log">;
  logs: string[];
  message: string | null;
  confirm: { command: string; sha256: string } | null;
  startedAt: number;
}

export interface Settings {
  projects: string[];
  autoCheck: boolean;
}

export interface Environment {
  claudeDir: string;
  claude: string | null;
  npx: string | null;
  git: string | null;
  gh: string | null;
  os: string;
  version: string;
}

// Mirrors src-tauri/src/updates/changelog.rs.

export interface ChangelogEntry {
  sha: string;
  date: string | null;
  message: string;
  url: string | null;
}

export interface ChangelogSection {
  version: string | null;
  title: string;
  /** Markdown. */
  body: string;
}

export interface Changelog {
  label: string;
  entries: ChangelogEntry[];
  total: number;
  sections: ChangelogSection[];
  sectionsLabel: string | null;
  moreUrl: string | null;
  note: string | null;
  /** A request failed; don't cache, so reopening the item tries again. */
  retryable: boolean;
}
