import { create } from "zustand";
import { api, errorText } from "./api";
import { applyTheme, emptyFilters, loadPrefs, savePrefs, type Filters, type Prefs, type SortKey, type Theme } from "./lib/prefs";
import type { ActionRequest, Item, Job, JobEvent, Settings } from "./types";

export type Busy = "idle" | "scanning" | "checking";

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
  queueOpen: boolean;
  restartNeeded: boolean;
  confirmation: Confirmation | null;
  settings: Settings;
  settingsOpen: boolean;

  init: () => Promise<void>;
  refresh: (opts?: { check?: boolean }) => Promise<void>;
  checkUpdates: () => Promise<void>;
  run: (requests: ActionRequest[]) => Promise<void>;
  onJob: (e: JobEvent) => void;
  setQuery: (q: string) => void;
  setFilters: (f: Partial<Filters>) => void;
  clearFilters: () => void;
  setSort: (key: SortKey) => void;
  setTheme: (t: Theme) => void;
  setActive: (id: string | null, open?: boolean) => void;
  closeDetail: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setQueueOpen: (open: boolean) => void;
  clearFinishedJobs: () => void;
  confirm: (c: Confirmation | null) => void;
  dismissRestart: () => void;
  dismissWarnings: () => void;
  setSettingsOpen: (open: boolean) => void;
  saveSettings: (s: Settings) => Promise<void>;
}

const prefs = loadPrefs();
/** Set when an action finished; the list is rescanned once the queue drains. */
let refreshAfterQueue = false;

export const useStore = create<State>((set, get) => {
  const persist = () => {
    const { theme, sort, filters } = get();
    savePrefs({ theme, sort, filters });
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
    queueOpen: false,
    restartNeeded: false,
    confirmation: null,
    settings: { projects: [], autoCheck: true },
    settingsOpen: false,

    init: async () => {
      try {
        set({ settings: await api.getSettings() });
      } catch (e) {
        set({ error: errorText(e) });
      }
      await get().refresh();
    },

    refresh: async (opts) => {
      if (get().busy !== "idle") return;
      set({ busy: "scanning", error: null });
      try {
        const r = await api.scan();
        const ids = new Set(r.items.map((i) => i.id));
        // Keep the last known status until the next check replaces it, unless the version changed.
        const prev = new Map(get().items.map((i) => [i.id, i]));
        const items = r.items.map((i) => {
          const p = prev.get(i.id);
          return p && p.status !== "unchecked" && p.version === i.version
            ? { ...i, status: p.status, latest: p.latest, statusDetail: p.statusDetail }
            : i;
        });
        set((s) => ({
          items,
          warnings: r.warnings,
          scannedAt: r.scannedAt,
          checkedAt: null,
          selected: new Set([...s.selected].filter((id) => ids.has(id))),
          activeId: s.activeId && ids.has(s.activeId) ? s.activeId : null,
        }));
      } catch (e) {
        set({ error: errorText(e), busy: "idle" });
        return;
      }
      set({ busy: "idle" });
      if (opts?.check ?? get().settings.autoCheck) await get().checkUpdates();
    },

    checkUpdates: async () => {
      if (get().busy !== "idle") return;
      set({ busy: "checking", error: null });
      try {
        const r = await api.checkUpdates();
        set((s) => ({ items: r.items, checkedAt: r.checkedAt, warnings: [...new Set([...s.warnings, ...r.warnings])] }));
      } catch (e) {
        set({ error: errorText(e) });
      } finally {
        set({ busy: "idle" });
      }
    },

    run: async (requests) => {
      if (!requests.length) return;
      try {
        await api.runActions(requests);
        set({ queueOpen: true });
      } catch (e) {
        set({ error: errorText(e) });
      }
    },

    onJob: (e) => {
      set((s) => {
        const prev = s.jobs[e.jobId];
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
        return { jobs: { ...s.jobs, [e.jobId]: next }, restartNeeded, confirmation };
      });

      if (e.state === "success") refreshAfterQueue = true;
      const active = Object.values(get().jobs).some((j) => j.state === "queued" || j.state === "running");
      if (!active && refreshAfterQueue) {
        refreshAfterQueue = false;
        void get().refresh({ check: true });
      }
    },

    setQuery: (query) => set({ query }),
    setFilters: (f) => {
      set((s) => ({ filters: { ...s.filters, ...f } }));
      persist();
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
      applyTheme(theme);
      set({ theme });
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
        jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, j]) => j.state === "queued" || j.state === "running")),
      })),
    confirm: (confirmation) => set({ confirmation }),
    dismissRestart: () => set({ restartNeeded: false }),
    dismissWarnings: () => set({ warnings: [] }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    saveSettings: async (settings) => {
      const projectsChanged = settings.projects.join("\n") !== get().settings.projects.join("\n");
      await api.saveSettings(settings);
      set({ settings });
      if (projectsChanged) await get().refresh();
    },
  };
});
