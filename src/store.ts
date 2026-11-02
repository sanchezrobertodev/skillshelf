import { create } from "zustand";
import { api, errorText } from "./api";
import { useAppUpdate } from "./appUpdate";
import { applyLanguage, group, t, type LanguagePref } from "./i18n";
import { canUpdate } from "./lib/format";
import { isUnused, sessionTokens } from "./lib/insights";
import { applyTheme, emptyFilters, loadPrefs, savePrefs, type Filters, type Palette, type Prefs, type SortKey, type Theme } from "./lib/prefs";
import type { ActionRequest, Item, Job, JobEvent, McpReport, Settings, TraySummary, Usage, UsageProgress } from "./types";

export type Busy = "idle" | "scanning" | "checking";
export type Screen = "overview" | "library" | "cleanup" | "mcp" | "settings";

export type Confirmation =
  | { type: "update"; items: Item[] }
  | { type: "uninstall"; items: Item[] }
  | { type: "command"; job: Job };

interface State extends Prefs {
  items: Item[];
  busy: Busy;
  scannedAt: number | null;
  checkedAt: number | null;
  warnings: string[];
  error: string | null;
  query: string;
  selected: Set<string>;
  activeId: string | null;
  detailOpen: boolean;
  jobs: Record<number, Job>;
  /** First job of the current batch: jobs queued while nothing else was running start a new one. */
  batchFrom: number;
  queueOpen: boolean;
  /** Uses per item id from local transcripts; null until the first count finishes. */
  usage: Record<string, Usage> | null;
  usageProgress: UsageProgress | null;
  mcp: McpReport | null;
  mcpBusy: boolean;
  mcpError: string | null;
  restartNeeded: boolean;
  confirmation: Confirmation | null;
  settings: Settings;
  screen: Screen;

  init: () => Promise<void>;
  refresh: (opts?: { check?: boolean }) => Promise<void>;
  checkUpdates: () => Promise<void>;
  run: (requests: ActionRequest[]) => Promise<void>;
  stop: () => Promise<void>;
  loadUsage: () => Promise<void>;
  loadMcp: () => Promise<void>;
  /** Opens the Library with only these filters. */
  browse: (f: Partial<Filters>) => void;
  /** Opens one item's details in the Library, clearing filters so its row is visible. */
  reveal: (id: string) => void;
  onJob: (e: JobEvent) => void;
  setQuery: (q: string) => void;
  setFilters: (f: Partial<Filters>) => void;
  clearFilters: () => void;
  setSort: (key: SortKey) => void;
  setTheme: (t: Theme) => void;
  setPalette: (p: Palette) => void;
  setLanguage: (l: LanguagePref) => void;
  setActive: (id: string | null, open?: boolean) => void;
  closeDetail: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setQueueOpen: (open: boolean) => void;
  clearFinishedJobs: () => void;
  confirm: (c: Confirmation | null) => void;
  dismissRestart: () => void;
  dismissWarnings: () => void;
  setScreen: (screen: Screen) => void;
  saveSettings: (s: Settings) => Promise<void>;
}

const prefs = loadPrefs();
let lastTray = "";

export const updatable = (items: Item[]) => items.filter((i) => i.status === "updateAvailable" && canUpdate(i));
export const isActive = (j: Job) => j.state === "queued" || j.state === "running";

function appUpdateLabel(): string | null {
  const { clone, update } = useAppUpdate.getState();
  if (!clone) return update?.version ?? null;
  return clone.behind && !clone.blocked ? t("app.commitsBehind", { count: clone.behind }) : null;
}

function traySummary(s: State): TraySummary {
  return {
    updates: updatable(s.items).map((i) => [i.id, i.name]),
    checking: s.busy === "checking",
    tokens: s.items.length ? sessionTokens(s.items) : null,
    unused: s.usage ? s.items.filter((i) => isUnused(i, s.usage)).length : null,
    appUpdate: appUpdateLabel(),
    text: group("tray."),
  };
}
/**
 * A rescan asked for while a scan or check ran, or after an action finished. It runs once nothing is
 * busy and the queue has drained, checking if any caller asked for a check.
 */
let pending: { check?: boolean } | null = null;

export const useStore = create<State>((set, get) => {
  const persist = () => {
    const { theme, palette, language, sort, filters } = get();
    savePrefs({ theme, palette, language, sort, filters });
  };
  const runPending = () => {
    const s = get();
    if (!pending || s.busy !== "idle" || Object.values(s.jobs).some(isActive)) return;
    const opts = pending;
    pending = null;
    void s.refresh(opts);
  };

  return {
    ...prefs,
    items: [],
    busy: "idle",
    scannedAt: null,
    checkedAt: null,
    warnings: [],
    error: null,
    query: "",
    selected: new Set(),
    activeId: null,
    detailOpen: false,
    jobs: {},
    batchFrom: 0,
    queueOpen: false,
    usage: null,
    usageProgress: null,
    mcp: null,
    mcpBusy: false,
    mcpError: null,
    restartNeeded: false,
    confirmation: null,
    settings: { projects: [], autoCheck: true, checkInterval: "daily", closeToTray: true, notifications: true },
    screen: "library",

    init: async () => {
      const syncTray = () => {
        const summary = traySummary(get());
        const json = JSON.stringify(summary);
        if (json === lastTray) return;
        lastTray = json;
        api.updateTray(summary).catch(() => {});
      };
      useStore.subscribe(syncTray);
      useAppUpdate.subscribe(syncTray);
      void api.onUsageProgress((usageProgress) => set({ usageProgress }));
      void api.onScheduledCheck(() => {
        void get().refresh({ check: true });
        void useAppUpdate.getState().check({ quiet: true });
      });
      void api.onTray((id) => {
        const s = get();
        if (id === "check") void s.refresh({ check: true });
        else if (id === "review-all") s.confirm({ type: "update", items: updatable(s.items) });
        else if (id.startsWith("review:")) {
          const item = s.items.find((i) => i.id === id.slice("review:".length));
          if (item) s.confirm({ type: "update", items: [item] });
        } else if (id === "overview" || id === "cleanup") s.setScreen(id);
        else if (id === "app-update") useAppUpdate.getState().setNotesOpen(true);
      });
      try {
        set({ settings: await api.getSettings() });
      } catch (e) {
        set({ error: errorText(e) });
      }
      await get().refresh();
    },

    refresh: async (opts) => {
      if (get().busy !== "idle") {
        pending = { check: pending?.check || opts?.check };
        return;
      }
      set({ busy: "scanning", error: null });
      try {
        // The scan command already keeps the last check's verdicts (scan::keep_verdicts).
        const r = await api.scan();
        const ids = new Set(r.items.map((i) => i.id));
        set((s) => ({
          items: r.items,
          warnings: r.warnings,
          scannedAt: r.scannedAt,
          checkedAt: null,
          selected: new Set([...s.selected].filter((id) => ids.has(id))),
          activeId: s.activeId && ids.has(s.activeId) ? s.activeId : null,
        }));
      } catch (e) {
        set({ error: errorText(e), busy: "idle" });
        runPending();
        return;
      }
      set({ busy: "idle" });
      void get().loadUsage();
      // checkUpdates runs the pending rescan itself when it finishes.
      if (opts?.check ?? get().settings.autoCheck) await get().checkUpdates();
      else runPending();
    },

    loadMcp: async () => {
      if (get().mcpBusy) return;
      set({ mcpBusy: true, mcpError: null });
      try {
        set({ mcp: await api.mcpStatus() });
      } catch (e) {
        set({ mcpError: errorText(e) });
      } finally {
        set({ mcpBusy: false });
      }
    },

    loadUsage: async () => {
      if (get().usageProgress) return;
      set({ usageProgress: { read: 0, total: 0 } });
      try {
        const r = await api.usage();
        set({ usage: r.byItem });
      } catch (e) {
        set((s) => ({ warnings: [...s.warnings, t("app.usageFailed", { error: errorText(e) })] }));
      } finally {
        set({ usageProgress: null });
      }
    },

    checkUpdates: async () => {
      if (get().busy !== "idle") return;
      // The backend refuses a check while actions run; the rescan after the queue drains does it instead.
      if (Object.values(get().jobs).some(isActive)) {
        pending = { check: true };
        return;
      }
      set({ busy: "checking", error: null });
      try {
        const r = await api.checkUpdates();
        set((s) => ({ items: r.items, checkedAt: r.checkedAt, warnings: [...new Set([...s.warnings, ...r.warnings])] }));
      } catch (e) {
        set({ error: errorText(e) });
      } finally {
        set({ busy: "idle" });
        runPending();
      }
    },

    run: async (requests) => {
      // The buttons stay enabled while a job waits; a second click would only queue a job that fails.
      // shortcut: a job counts once its queued event arrives, add an in-flight set if two calls can beat that.
      const active = Object.values(get().jobs).filter(isActive);
      requests = requests.filter((r) => !active.some((j) => j.itemId === r.itemId && j.action === r.action));
      if (!requests.length) return;
      try {
        await api.runActions(requests);
        set({ queueOpen: true });
      } catch (e) {
        set({ error: errorText(e) });
      }
    },

    stop: async () => {
      try {
        await api.stopActions();
      } catch (e) {
        set({ error: errorText(e) });
      }
    },

    onJob: (e) => {
      set((s) => {
        const prev = s.jobs[e.jobId];
        const idle = !Object.values(s.jobs).some(isActive);
        const batchFrom = !prev && idle ? e.jobId : s.batchFrom;
        const job: Job = prev ?? {
          jobId: e.jobId,
          itemId: e.itemId,
          itemName: e.itemName,
          action: e.action,
          state: "queued",
          logs: [],
          message: null,
          confirm: null,
          startedAt: Date.now(),
        };
        const next: Job =
          e.state === "log"
            ? { ...job, logs: [...job.logs, e.line ?? ""].slice(-500) }
            : { ...job, state: e.state, message: e.message ?? job.message, confirm: e.confirm ?? job.confirm };
        const item = s.items.find((i) => i.id === e.itemId);
        const restartNeeded = s.restartNeeded || (e.state === "success" && item?.kind === "plugin");
        const confirmation =
          e.state === "needsConfirmation" && !s.confirmation ? ({ type: "command", job: next } as const) : s.confirmation;
        return { jobs: { ...s.jobs, [e.jobId]: next }, batchFrom, restartNeeded, confirmation };
      });

      if (e.state === "success") pending = { check: true };
      runPending();
    },

    // Searching always shows the results, wherever you typed.
    setQuery: (query) => set({ query, screen: "library" }),
    setFilters: (f) => {
      set((s) => ({ filters: { ...s.filters, ...f } }));
      persist();
    },
    browse: (f) => {
      set({ filters: { ...emptyFilters, ...f }, query: "", screen: "library" });
      persist();
    },
    reveal: (id) => {
      get().browse({});
      set({ activeId: id, detailOpen: true });
    },
    clearFilters: () => {
      set({ filters: emptyFilters, query: "" });
      persist();
    },
    setSort: (key) => {
      set((s) => ({ sort: { key, desc: s.sort.key === key ? !s.sort.desc : false } }));
      persist();
    },
    setTheme: (theme) => {
      applyTheme(theme, get().palette);
      set({ theme });
      persist();
    },
    setPalette: (palette) => {
      applyTheme(get().theme, palette);
      set({ palette });
      persist();
    },
    setLanguage: (language) => {
      applyLanguage(language);
      set({ language });
      persist();
    },
    setActive: (activeId, open = true) => set((s) => ({ activeId, detailOpen: open || s.detailOpen })),
    closeDetail: () => set({ detailOpen: false }),
    toggleSelected: (id) =>
      set((s) => {
        const selected = new Set(s.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        return { selected };
      }),
    setSelected: (ids) => set({ selected: new Set(ids) }),
    setQueueOpen: (queueOpen) => set({ queueOpen }),
    clearFinishedJobs: () =>
      set((s) => ({
        jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, j]) => isActive(j))),
      })),
    confirm: (confirmation) => set({ confirmation }),
    dismissRestart: () => set({ restartNeeded: false }),
    dismissWarnings: () => set({ warnings: [] }),
    setScreen: (screen) => set({ screen }),
    saveSettings: async (settings) => {
      const projectsChanged = settings.projects.join("\n") !== get().settings.projects.join("\n");
      await api.saveSettings(settings);
      set({ settings });
      if (projectsChanged) await get().refresh();
    },
  };
});
