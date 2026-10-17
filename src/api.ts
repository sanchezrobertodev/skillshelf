import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type {
  ActionRequest,
  AppUpdate,
  Changelog,
  CheckResult,
  DownloadProgress,
  Environment,
  JobEvent,
  ScanResult,
  Settings,
} from "./types";

/** The update found by the last check, kept for installing. */
let pendingUpdate: Update | null = null;

const tauriApi = {
  scan: () => invoke<ScanResult>("scan"),
  checkUpdates: () => invoke<CheckResult>("check_updates"),
  runActions: (requests: ActionRequest[]) =>
    invoke<{ jobId: number; itemId: string }[]>("run_actions", { requests }),
  openFolder: (itemId: string) => invoke<void>("open_item_folder", { itemId }),
  openRepo: (itemId: string) => invoke<void>("open_item_repo", { itemId }),
  changelog: (itemId: string) => invoke<Changelog>("item_changelog", { itemId }),
  openChangelogLink: (itemId: string, url: string) => invoke<void>("open_changelog_link", { itemId, url }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  environment: () => invoke<Environment>("environment"),
  pickFolder: async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a project folder" });
    return typeof picked === "string" ? picked : null;
  },
  onJob: (cb: (e: JobEvent) => void): Promise<UnlistenFn> => listen<JobEvent>("job", (e) => cb(e.payload)),
  checkAppUpdate: async (): Promise<AppUpdate | null> => {
    const update = await check();
    void pendingUpdate?.close().catch(() => {});
    pendingUpdate = update;
    if (!update) return null;
    return { version: update.version, currentVersion: update.currentVersion, date: update.date ?? null, notes: update.body ?? null };
  },
  /** Downloads and installs the pending update, then restarts the app. On Windows the installer closes the app itself. */
  installAppUpdate: async (onProgress: (p: DownloadProgress) => void) => {
    if (!pendingUpdate) throw new Error("No update to install. Check for updates first.");
    const progress: DownloadProgress = { downloaded: 0, total: null };
    await pendingUpdate.downloadAndInstall((e) => {
      if (e.event === "Started") progress.total = e.data.contentLength ?? null;
      else if (e.event === "Progress") progress.downloaded += e.data.chunkLength;
      onProgress({ ...progress });
    });
    await relaunch();
  },
};

// Outside Tauri in dev (plain `npm run dev` in a browser), use the mock backend.
const mock = !("__TAURI_INTERNALS__" in window) && import.meta.env.DEV ? import("./dev/mock").then((m) => m.mockApi) : null;

type Api = typeof tauriApi;
export const api: Api = mock
  ? (Object.fromEntries(
      Object.keys(tauriApi).map((k) => [k, async (...args: unknown[]) => ((await mock) as any)[k](...args)]),
    ) as Api)
  : tauriApi;

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
