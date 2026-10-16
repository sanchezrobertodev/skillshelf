import { Download, LoaderCircle, Monitor, Moon, RefreshCw, Search, Settings, Sun, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { relativeTime } from "../lib/format";
import type { Theme } from "../lib/prefs";
import { useStore } from "../store";
import { Button, IconButton, Kbd } from "./ui";

const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const themeIcon = { system: Monitor, light: Sun, dark: Moon };

export function Toolbar() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const busy = useStore((s) => s.busy);
  const checkedAt = useStore((s) => s.checkedAt);
  const items = useStore((s) => s.items);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const checkUpdates = useStore((s) => s.checkUpdates);
  const refresh = useStore((s) => s.refresh);
  const run = useStore((s) => s.run);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const search = useRef<HTMLInputElement>(null);

  const updatable = items.filter((i) => i.status === "updateAvailable");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  const ThemeIcon = themeIcon[theme];
  const status =
    busy === "scanning"
      ? "Scanning installed items…"
      : busy === "checking"
        ? "Checking for updates…"
        : checkedAt
          ? `Checked ${relativeTime(checkedAt)}`
          : "Not checked yet";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="flex w-[200px] shrink-0 items-center gap-2">
        <svg aria-hidden viewBox="0 0 24 24" className="size-6 text-accent">
          <rect x="3" y="4" width="4" height="16" rx="1" fill="currentColor" />
          <rect x="9" y="7" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
          <rect x="15.5" y="5" width="4" height="15" rx="1" fill="currentColor" opacity="0.45" transform="rotate(-12 17.5 12.5)" />
          <rect x="2" y="20" width="20" height="1.6" rx="0.8" fill="currentColor" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Skillshelf</span>
      </div>

      <div className="relative max-w-xl min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search skills, plugins, commands…"
          aria-label="Search"
          className="h-9 w-full rounded-md border border-border-strong bg-bg pr-16 pl-9 text-sm placeholder:text-muted focus-visible:outline-2"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <IconButton label="Clear search" className="size-7" onClick={() => setQuery("")}>
              <X className="size-3.5" />
            </IconButton>
          ) : (
            <Kbd>Ctrl K</Kbd>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-xs text-muted lg:inline" aria-live="polite">
          {status}
        </span>
        <Button onClick={() => void checkUpdates()} disabled={busy !== "idle"} title="Refresh catalogs and compare versions">
          {busy === "checking" ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="size-4" />
          )}
          Check for updates
        </Button>
        <Button
          variant="primary"
          disabled={!updatable.length}
          onClick={() => void run(updatable.map((i) => ({ itemId: i.id, action: "update" as const })))}
        >
          <Download aria-hidden className="size-4" />
          Update all{updatable.length ? ` (${updatable.length})` : ""}
        </Button>
        <IconButton label={`Theme: ${theme} (switch to ${nextTheme[theme]})`} onClick={() => setTheme(nextTheme[theme])}>
          <ThemeIcon className="size-4" />
        </IconButton>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}
