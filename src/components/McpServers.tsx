import clsx from "clsx";
import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, Clock, KeyRound, LoaderCircle, Puzzle, RefreshCw, Server } from "lucide-react";
import { useEffect } from "react";
import { t, type TKey, useT } from "../i18n";
import { relativeTime } from "../lib/format";
import { useStore } from "../store";
import type { McpServer, McpState } from "../types";
import { Button, card } from "./ui";

export const mcpMeta: Record<McpState, { label: TKey; icon: typeof CircleCheck; cls: string; order: number }> = {
  failed: { label: "mcp.state.failed", icon: CircleAlert, cls: "text-danger bg-danger/10 border-danger/35", order: 0 },
  needsAuth: { label: "mcp.state.needsAuth", icon: KeyRound, cls: "text-info bg-info/10 border-info/30", order: 1 },
  pending: { label: "mcp.state.pending", icon: Clock, cls: "text-muted bg-surface-2 border-border", order: 2 },
  notConfigured: { label: "mcp.state.notConfigured", icon: CircleDashed, cls: "text-muted bg-surface-2 border-border", order: 3 },
  unknown: { label: "mcp.state.unknown", icon: CircleHelp, cls: "text-muted bg-surface-2 border-border", order: 4 },
  connected: { label: "mcp.state.connected", icon: CircleCheck, cls: "text-accent bg-accent/10 border-accent/30", order: 5 },
};

function Chip({ state }: { state: McpState }) {
  const t = useT();
  const { label, icon: Icon, cls } = mcpMeta[state];
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap", cls)}>
      <Icon aria-hidden className="size-3.5" />
      {t(label)}
    </span>
  );
}

interface Group {
  key: string;
  title: string;
  hint: string;
  plugin: string | null;
  servers: McpServer[];
}

function groups(servers: McpServer[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of servers) {
    const key = s.plugin ? `plugin:${s.plugin}` : s.claudeAi ? "claude.ai" : "own";
    if (!map.has(key))
      map.set(key, {
        key,
        plugin: s.plugin,
        title: s.plugin ?? (s.claudeAi ? t("mcp.claudeAi") : t("mcp.own")),
        hint: s.plugin ? t("mcp.fromPlugin") : s.claudeAi ? t("mcp.claudeAiHint") : t("mcp.ownHint"),
        servers: [],
      });
    map.get(key)!.servers.push(s);
  }
  const worst = (g: Group) => Math.min(...g.servers.map((s) => mcpMeta[s.state].order));
  for (const g of map.values()) g.servers.sort((a, b) => mcpMeta[a.state].order - mcpMeta[b.state].order || a.name.localeCompare(b.name));
  return [...map.values()].sort((a, b) => worst(a) - worst(b) || a.title.localeCompare(b.title));
}

export function McpServers() {
  const t = useT();
  const mcp = useStore((s) => s.mcp);
  const busy = useStore((s) => s.mcpBusy);
  const error = useStore((s) => s.mcpError);
  const load = useStore((s) => s.loadMcp);
  const items = useStore((s) => s.items);
  const reveal = useStore((s) => s.reveal);

  // Checking starts every server, so it runs when this screen is first opened rather than at launch.
  useEffect(() => {
    const s = useStore.getState();
    if (!s.mcp && !s.mcpBusy && !s.mcpError) void s.loadMcp();
  }, []);

  const counts = new Map<McpState, number>();
  for (const s of mcp?.servers ?? []) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
  const pluginItem = (name: string) => items.find((i) => i.kind === "plugin" && i.name === name);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
      <div className={clsx(card, "flex shrink-0 flex-wrap items-center gap-3 px-4 py-3")}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px]" aria-live="polite">
            {busy
              ? t("mcp.connecting")
              : mcp
                ? [...counts]
                    .sort(([a], [b]) => mcpMeta[a].order - mcpMeta[b].order)
                    .map(([s, n]) => t(`mcp.count.${s}`, { count: n }))
                    .join(" · ") || t("mcp.none")
                : t("mcp.notChecked")}
          </p>
          <p className="text-xs text-muted">
            {mcp && `${t("mcp.checked", { time: relativeTime(mcp.checkedAt) })} `}{t("mcp.runsList")}
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void load()}>
          {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
          {busy ? t("mcp.checking") : t("mcp.check")}
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px]">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1">{t("mcp.listFailed", { error })}</p>
        </div>
      )}

      {mcp && mcp.servers.length === 0 && (
        <div className={clsx(card, "flex shrink-0 flex-col items-center gap-2 p-8 text-center")}>
          <Server aria-hidden className="size-8 text-muted" />
          <p className="font-medium">{t("mcp.empty")}</p>
          <p className="max-w-sm text-[13px] text-muted">{t("mcp.emptyHint")}</p>
        </div>
      )}

      {mcp &&
        groups(mcp.servers).map((g) => {
          const item = g.plugin ? pluginItem(g.plugin) : undefined;
          return (
            <section key={g.key} aria-label={g.title} className={clsx(card, "shrink-0 overflow-hidden")}>
              <header className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
                {g.plugin && <Puzzle aria-hidden className="size-4 shrink-0 self-center text-info" />}
                {item ? (
                  <button type="button" onClick={() => reveal(item.id)} className="truncate rounded text-[13px] font-semibold hover:underline">
                    {g.title}
                  </button>
                ) : (
                  <h2 className="truncate text-[13px] font-semibold">{g.title}</h2>
                )}
                <span className="truncate text-xs text-muted">{g.hint}</span>
              </header>
              <ul className="divide-y divide-border">
                {g.servers.map((s) => (
                  <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium">{s.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted">
                        {[s.target, s.transport?.toUpperCase()].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <Chip state={s.state} />
                    {s.reason && <p className="col-span-2 text-xs text-muted">{s.reason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
