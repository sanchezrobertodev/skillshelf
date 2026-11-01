import { Download, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { relativeTime } from "../lib/format";
import { type Screen, useStore } from "../store";
import { Button, IconButton, Kbd } from "./ui";

const titles: Record<Screen, string> = { overview: "Overview", library: "Library", cleanup: "Clean Up", mcp: "MCP Servers" };

export function Toolbar() {
  const screen = useStore((s) => s.screen);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const busy = useStore((s) => s.busy);
  const checkedAt = useStore((s) => s.checkedAt);
  const items = useStore((s) => s.items);
  const checkUpdates = useStore((s) => s.checkUpdates);
  const refresh = useStore((s) => s.refresh);
  const confirm = useStore((s) => s.confirm);
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

  const status =
    busy === "scanning"
      ? "Scanning installed items…"
      : busy === "checking"
        ? "Checking for updates…"
        : checkedAt
          ? `Checked ${relativeTime(checkedAt)}`
          : "Not checked yet";

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-5">
      <h1 className="text-lg font-semibold tracking-tight">{titles[screen]}</h1>
      <span className="hidden text-xs text-muted lg:inline" aria-live="polite">
        {status}
      </span>

      <div className="relative ml-auto w-full max-w-sm min-w-0">
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
          className="h-9 w-full rounded-lg border border-border bg-surface pr-16 pl-9 text-sm shadow-card placeholder:text-muted focus-visible:outline-2"
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

      <Button onClick={() => void checkUpdates()} disabled={busy !== "idle"} title="Refresh catalogs and compare versions">
        {busy === "checking" ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-4" />
        )}
        Check now
      </Button>
      <Button variant="update" disabled={!updatable.length} onClick={() => confirm({ type: "update", items: updatable })}>
        <Download aria-hidden className="size-4" />
        {updatable.length ? `Review ${updatable.length} update${updatable.length === 1 ? "" : "s"}` : "No updates"}
      </Button>
    </header>
  );
}
