// Mirrors src-tauri/src/model.rs and actions.rs.

export type Kind = "plugin" | "skill";
export type Source = "marketplace" | "synced" | "skillsCli" | "local" | "project";
export type Status =
  | "unchecked"
  | "upToDate"
  | "updateAvailable"
  | "unknown"
  | "managed"
  | "untracked"
  | "error"
  | "moved"
  | "removed";

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
  /** Plugins only: size of the plugin's saved data folder; null when it's missing or empty. */
  dataBytes: number | null;
  /** A Claude Code mod: a plugin whose hooks/hooks.json loads UI modules. */
  isMod: boolean;
  /** Rough tokens added to every session while it's on (skill, command and agent listings). */
  cost: Cost | null;
  issues: Issue[];
  /** Set when status is "moved" or "removed". */
  upstream: Upstream | null;
}

export interface Cost {
  total: number;
  parts: { kind: "skill" | "command" | "agent"; name: string; tokens: number }[];
}

export interface Issue {
  code:
    | "no-frontmatter"
    | "bad-frontmatter"
    | "no-description"
    | "long-description"
    | "link-missing"
    | "link-replaced"
    | "duplicate-name";
  message: string;
}

export interface Upstream {
  /** owner/repo the skill lives in now. */
  repo: string;
  folder: string | null;
  /** The commit that deleted it ("removed"). */
  commit: ChangelogEntry | null;
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

export type Action = "update" | "enable" | "disable" | "uninstall" | "reinstall";

export interface ActionRequest {
  itemId: string;
  action: Action;
  acceptCommand?: string;
  /** Uninstall only: also delete the plugin's saved data. */
  deleteData?: boolean;
}

export type JobState = "queued" | "running" | "log" | "success" | "failed" | "needsConfirmation" | "cancelled";

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
  /** What the update adds or changes that runs without asking; null when it couldn't be checked. */
  risks: Risk[] | null;
  /** The commit the installed version matches, when known. */
  installed: ChangelogEntry | null;
}

export interface Risk {
  kind: "hooks" | "mcp" | "scripts" | "allowedTools";
  /** Relative to the plugin or skill folder. */
  files: string[];
  why: string;
}

// Mirrors src-tauri/src/mcp.rs.

export type McpState = "connected" | "needsAuth" | "failed" | "notConfigured" | "pending" | "unknown";

export interface McpServer {
  /** The plugin that ships it. */
  plugin: string | null;
  /** A claude.ai connector. */
  claudeAi: boolean;
  name: string;
  /** The URL's host or the command's program name; never the full URL or arguments. */
  target: string | null;
  transport: string | null;
  state: McpState;
  reason: string | null;
}

export interface McpReport {
  servers: McpServer[];
  checkedAt: number;
}

// Mirrors src-tauri/src/usage.rs.

export interface Usage {
  /** Uses in the last 30 days. */
  uses: number;
  lastUsed: string | null;
  /** 30 days, oldest first, ending today (UTC). */
  daily: number[];
}

export interface UsageReport {
  byItem: Record<string, Usage>;
  files: number;
  indexedAt: number;
}

export interface UsageProgress {
  read: number;
  total: number;
}

export interface Readme {
  file: string;
  /** Markdown, without front matter. */
  text: string;
  truncated: boolean;
}

/** What the tray menu and window title show; sent to the backend whenever it changes. */
export interface TraySummary {
  /** [item id, name] of each pending update. */
  updates: [string, string][];
  checking: boolean;
  tokens: number | null;
  unused: number | null;
  appUpdate: string | null;
}

export interface LastRun {
  action: Action;
  state: Exclude<JobState, "log" | "queued" | "running">;
  message: string | null;
  lines: string[];
  finishedAt: number;
}

/** A newer Skillshelf release found by the updater. */
export interface AppUpdate {
  version: string;
  currentVersion: string;
  date: string | null;
  /** Release notes (the CHANGELOG section for that version, as Markdown). */
  notes: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}
