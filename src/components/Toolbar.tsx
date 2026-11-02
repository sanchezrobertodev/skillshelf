import { Download, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { type TKey, useT } from "../i18n";
import { relativeTime } from "../lib/format";
import { type Screen, updatable, useStore } from "../store";
import { Button, IconButton, Kbd } from "./ui";

const titles: Record<Screen, TKey> = {
  overview: "rail.overview",
  library: "rail.library",
  cleanup: "rail.cleanup",
  mcp: "toolbar.mcpServers",
  settings: "rail.settings",
};

export function Toolbar() {
  const t = useT();
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

  const toUpdate = updatable(items);

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
      ? t("toolbar.scanning")
      : busy === "checking"
        ? t("toolbar.checking")
        : checkedAt
          ? t("toolbar.checked", { time: relativeTime(checkedAt) })
          : t("toolbar.notChecked");

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-5">
      <h1 className="shrink-0 text-lg font-semibold tracking-tight">{t(titles[screen])}</h1>
      <span className="hidden shrink-0 text-xs whitespace-nowrap text-muted lg:inline" aria-live="polite">
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
          placeholder={t("toolbar.searchPlaceholder")}
          aria-label={t("toolbar.search")}
          className="h-9 w-full rounded-lg border border-border bg-surface pr-16 pl-9 text-sm shadow-card placeholder:text-muted focus-visible:outline-2"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <IconButton label={t("toolbar.clearSearch")} className="size-7" onClick={() => setQuery("")}>
              <X className="size-3.5" />
            </IconButton>
          ) : (
            <Kbd>Ctrl K</Kbd>
          )}
        </div>
      </div>

      <Button onClick={() => void checkUpdates()} disabled={busy !== "idle"} title={t("toolbar.checkTitle")}>
        {busy === "checking" ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-4" />
        )}
        {t("toolbar.check")}
      </Button>
      <Button variant="update" disabled={!toUpdate.length} onClick={() => confirm({ type: "update", items: toUpdate })}>
        <Download aria-hidden className="size-4" />
        {toUpdate.length ? t("toolbar.review", { count: toUpdate.length }) : t("toolbar.noUpdates")}
      </Button>
    </header>
  );
}
