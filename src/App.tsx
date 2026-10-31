import { BrushCleaning, CircleAlert, LayoutDashboard, RotateCcw, Server, TriangleAlert, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAppUpdate } from "./appUpdate";
import { AppUpdateBanner, ReleaseNotesDialog } from "./components/AppUpdate";
import { DetailPanel } from "./components/DetailPanel";
import { ConfirmDialogs, SettingsDialog } from "./components/Dialogs";
import { FilterSidebar } from "./components/FilterSidebar";
import { ItemList } from "./components/ItemList";
import { QueueDrawer } from "./components/QueueDrawer";
import { Rail } from "./components/Rail";
import { Toolbar } from "./components/Toolbar";
import { card, IconButton } from "./components/ui";
import { matches, sortItems } from "./lib/filter";
import { applyTheme, onSystemThemeChange } from "./lib/prefs";
import { type Screen, useStore } from "./store";

function useWide(min: number) {
  const [wide, setWide] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [min]);
  return wide;
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "warn" | "danger" | "info";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const Icon = tone === "danger" ? CircleAlert : tone === "warn" ? TriangleAlert : RotateCcw;
  const cls = { warn: "border-warn/35 bg-warn/10", danger: "border-danger/40 bg-danger/10", info: "border-info/35 bg-info/10" }[tone];
  const icon = { warn: "text-warn", danger: "text-danger", info: "text-info" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`mx-5 mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${cls}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <IconButton label="Dismiss" className="-my-1 size-7" onClick={onDismiss}>
          <X className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

export default function App() {
  const items = useStore((s) => s.items);
  const filters = useStore((s) => s.filters);
  const sort = useStore((s) => s.sort);
  const query = useDeferredValue(useStore((s) => s.query));
  const activeId = useStore((s) => s.activeId);
  const detailOpen = useStore((s) => s.detailOpen);
  const warnings = useStore((s) => s.warnings);
  const error = useStore((s) => s.error);
  const restartNeeded = useStore((s) => s.restartNeeded);
  const theme = useStore((s) => s.theme);
  const screen = useStore((s) => s.screen);
  const wide = useWide(1240);

  useEffect(() => {
    const s = useStore.getState();
    void s.init();
    void useAppUpdate.getState().check({ quiet: true });
    const unlisten = api.onJob(s.onJob);
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => (theme === "system" ? onSystemThemeChange(() => applyTheme("system")) : undefined), [theme]);

  const rows = useMemo(
    () => sortItems(items.filter((i) => matches(i, filters, query)), sort.key, sort.desc),
    [items, filters, query, sort],
  );
  const active = detailOpen ? items.find((i) => i.id === activeId) : undefined;

  return (
    <div className="flex h-full">
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <AppUpdateBanner />
        {error && (
          <Banner tone="danger" onDismiss={() => useStore.setState({ error: null })}>
            {error}
          </Banner>
        )}
        {restartNeeded && (
          <Banner tone="info" onDismiss={() => useStore.getState().dismissRestart()}>
            Plugin changes take effect after you restart Claude Code.
          </Banner>
        )}
        {warnings.length > 0 && (
          <Banner tone="warn" onDismiss={() => useStore.getState().dismissWarnings()}>
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Banner>
        )}
        {screen === "library" ? (
          <div className="relative flex min-h-0 flex-1 gap-3 pr-5 pb-4">
            <FilterSidebar />
            <ItemList rows={rows} />
            {active && <DetailPanel item={active} overlay={!wide} />}
          </div>
        ) : (
          <Pending screen={screen} />
        )}
        <QueueDrawer />
      </main>
      <ConfirmDialogs />
      <SettingsDialog />
      <ReleaseNotesDialog />
    </div>
  );
}

// shortcut: placeholders until the Overview, Clean Up and MCP screens land (plan M4); delete with them.
const pending: Record<Exclude<Screen, "library">, { icon: typeof Server; text: string }> = {
  overview: { icon: LayoutDashboard, text: "Updates, context cost, unused plugins and problems at a glance." },
  cleanup: { icon: BrushCleaning, text: "Unused plugins by context cost, hook plugins, and skills moved or removed upstream." },
  mcp: { icon: Server, text: "Every MCP server, grouped by the plugin that brings it, with its connection status." },
};

function Pending({ screen }: { screen: Exclude<Screen, "library"> }) {
  const { icon: Icon, text } = pending[screen];
  return (
    <div className={`mx-5 mb-4 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center ${card}`}>
      <Icon aria-hidden className="size-8 text-muted" />
      <p className="font-medium">Coming in the next update</p>
      <p className="max-w-sm text-[13px] text-muted">{text}</p>
    </div>
  );
}
