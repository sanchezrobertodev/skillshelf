import { create } from "zustand";
import { api, errorText } from "./api";
import type { AppUpdate, DownloadProgress } from "./types";

/** Skillshelf's own updates (the Tauri updater), separate from skill/plugin updates in store.ts. */
export type AppUpdatePhase = "idle" | "checking" | "upToDate" | "available" | "installing" | "error";

interface AppUpdateState {
  phase: AppUpdatePhase;
  update: AppUpdate | null;
  progress: DownloadProgress | null;
  error: string | null;
  /** The error came from installing, not checking. */
  installFailed: boolean;
  /** Banner hidden for this session. Settings still shows the update. */
  dismissed: boolean;
  notesOpen: boolean;

  /** `quiet` (the launch check) keeps network errors out of the banner. */
  check: (opts?: { quiet?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
  setNotesOpen: (open: boolean) => void;
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  phase: "idle",
  update: null,
  progress: null,
  error: null,
  installFailed: false,
  dismissed: false,
  notesOpen: false,

  check: async (opts) => {
    const { phase } = get();
    if (phase === "checking" || phase === "installing") return;
    set({ phase: "checking", error: null, installFailed: false });
    try {
      const update = await api.checkAppUpdate();
      set({ update, phase: update ? "available" : "upToDate", dismissed: opts?.quiet ? get().dismissed : false });
    } catch (e) {
      // A failed launch check (offline, no release feed yet) isn't worth a banner.
      set({ phase: opts?.quiet ? "idle" : "error", error: errorText(e) });
    }
  },

  install: async () => {
    if (get().phase === "installing" || !get().update) return;
    set({ phase: "installing", progress: null, error: null, installFailed: false, notesOpen: false, dismissed: false });
    try {
      await api.installAppUpdate((progress) => set({ progress }));
    } catch (e) {
      set({ phase: "error", error: errorText(e), installFailed: true });
    }
  },

  dismiss: () => set({ dismissed: true }),
  setNotesOpen: (notesOpen) => set({ notesOpen }),
}));
