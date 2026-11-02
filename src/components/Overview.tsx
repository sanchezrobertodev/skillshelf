import {
  BrushCleaning,
  CircleAlert,
  CircleArrowUp,
  Download,
  FolderSymlink,
  Gauge,
  LibraryBig,
  LoaderCircle,
  RefreshCw,
  Server,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useT } from "../i18n";
import { cx } from "../lib/cx";
import { issueText, relativeTime } from "../lib/format";
import { isUnused, loadsEverywhere, sessionTokens, shortCount } from "../lib/insights";
import { updatable, useStore } from "../store";
import { Button, card } from "./ui";
import { mcpMeta } from "./McpServers";

const TOP = 5;

function Tile({ title, icon: Icon, children, actions }: { title: string; icon: typeof Gauge; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(card, "flex flex-col p-4")}>
      <h2 id={id} className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
        <Icon aria-hidden className="size-4" />
        {title}
      </h2>
      <div className="flex-1">{children}</div>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

function Big({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <p>
      <span className={cx("block text-3xl font-semibold tracking-tight tabular-nums", tone)}>{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </p>
  );
}

export function Overview() {
  const t = useT();
  const items = useStore((s) => s.items);
  const usage = useStore((s) => s.usage);
  const progress = useStore((s) => s.usageProgress);
  const mcp = useStore((s) => s.mcp);
  const mcpBusy = useStore((s) => s.mcpBusy);
  const busy = useStore((s) => s.busy);
  const checkedAt = useStore((s) => s.checkedAt);
  const confirm = useStore((s) => s.confirm);
  const browse = useStore((s) => s.browse);
  const reveal = useStore((s) => s.reveal);
  const setScreen = useStore((s) => s.setScreen);
  const checkUpdates = useStore((s) => s.checkUpdates);
  const loadMcp = useStore((s) => s.loadMcp);

  if (!items.length)
    return (
      <div className={cx(card, "mx-5 mb-4 flex flex-1 items-center justify-center gap-2 text-[13px] text-muted")}>
        {busy === "scanning" ? (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {t("overview.scanning")}
          </>
        ) : (
          t("overview.noItems")
        )}
      </div>
    );

  const pending = updatable(items);
  const tokens = sessionTokens(items);
  const heavy = items
    .filter((i) => loadsEverywhere(i) && i.cost?.total)
    .sort((a, b) => (b.cost?.total ?? 0) - (a.cost?.total ?? 0))
    .slice(0, TOP);
  const max = heavy[0]?.cost?.total ?? 1;
  const unused = usage ? items.filter((i) => isUnused(i, usage)) : null;
  const unusedTokens = unused?.reduce((n, i) => n + (i.cost?.total ?? 0), 0) ?? 0;
  const withIssues = items.filter((i) => i.issues.length);
  const moved = items.filter((i) => i.status === "moved").length;
  const removed = items.filter((i) => i.status === "removed").length;
  const problems = (mcp?.servers.filter((s) => s.state !== "connected") ?? []).sort((a, b) => mcpMeta[a.state].order - mcpMeta[b.state].order);
  const plugins = items.filter((i) => i.kind === "plugin");
  const off = plugins.filter((i) => i.enabled === false).length;

  const byCost = () => {
    useStore.setState({ sort: { key: "cost", desc: true } });
    browse({});
  };

  return (
    <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 overflow-y-auto px-5 pb-4">
      <Tile
        title={t("overview.updates")}
        icon={CircleArrowUp}
        actions={
          pending.length ? (
            <>
              <Button variant="update" size="sm" onClick={() => confirm({ type: "update", items: pending })}>
                <Download aria-hidden className="size-3.5" />
                {t("overview.review", { count: pending.length })}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => browse({ statuses: ["updateAvailable"] })}>
                {t("overview.showInLibrary")}
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy !== "idle"} onClick={() => void checkUpdates()}>
              <RefreshCw aria-hidden className={cx("size-3.5", busy === "checking" && "animate-spin")} />
              {t("overview.checkNow")}
            </Button>
          )
        }
      >
        <Big
          value={pending.length || t("overview.none")}
          tone={pending.length ? "text-warn" : undefined}
          label={pending.length ? t("overview.pending", { count: pending.length }) : t("overview.upToDate")}
        />
        <p className="mt-1 text-xs text-muted">{checkedAt ? t("overview.checked", { time: relativeTime(checkedAt) }) : t("overview.notChecked")}</p>
      </Tile>

      <Tile
        title={t("overview.context")}
        icon={Gauge}
        actions={
          <Button variant="ghost" size="sm" onClick={byCost}>
            {t("overview.sortByCost")}
          </Button>
        }
      >
        <Big value={`≈${shortCount(tokens)}`} label={t("overview.tokensLabel")} />
        {heavy.length > 0 && (
          <ol aria-label={t("overview.heaviest")} className="mt-3 space-y-1.5">
            {heavy.map((i) => (
              <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_72px_40px] items-center gap-2 text-xs">
                <button type="button" onClick={() => reveal(i.id)} className="truncate rounded text-left hover:underline">
                  {i.name}
                </button>
                <span aria-hidden className="h-1.5 rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${((i.cost?.total ?? 0) / max) * 100}%` }} />
                </span>
                <span className="text-right font-mono text-muted tabular-nums">{shortCount(i.cost?.total ?? 0)}</span>
              </li>
            ))}
          </ol>
        )}
      </Tile>

      <Tile
        title={t("cleanup.unused")}
        icon={BrushCleaning}
        actions={
          unused && (
            <Button size="sm" onClick={() => setScreen("cleanup")}>
              {t("overview.openCleanUp")}
            </Button>
          )
        }
      >
        {unused ? (
          <>
            <Big value={unused.length} label={t("overview.unused", { count: unused.length })} />
            {unusedTokens > 0 && <p className="mt-1 text-xs text-muted">{t("overview.unusedFrees", { tokens: shortCount(unusedTokens) })}</p>}
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {progress?.total ? t("cleanup.countingProgress", { read: progress.read, total: progress.total }) : t("cleanup.counting")}
          </p>
        )}
      </Tile>

      <Tile
        title={t("overview.mcp")}
        icon={Server}
        actions={
          mcp ? (
            <Button size="sm" onClick={() => setScreen("mcp")}>
              {t("overview.openMcp")}
            </Button>
          ) : (
            <Button size="sm" disabled={mcpBusy} onClick={() => void loadMcp()}>
              {mcpBusy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
              {mcpBusy ? t("mcp.checking") : t("mcp.check")}
            </Button>
          )
        }
      >
        {mcp ? (
          <>
            <Big
              value={problems.length ? problems.length : mcp.servers.length}
              tone={problems.length ? "text-danger" : undefined}
              label={
                problems.length
                  ? t("overview.mcpAttention", { count: problems.length, total: mcp.servers.length })
                  : t("overview.mcpConnected", { count: mcp.servers.length })
              }
            />
            {problems.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {problems.slice(0, 3).map((s) => (
                  <li key={`${s.plugin}:${s.name}`} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                    <span className="shrink-0 text-muted">{t(mcpMeta[s.state].label)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[13px] text-muted">
            {mcpBusy
              ? t("overview.mcpConnecting")
              : t("overview.mcpNotChecked")}
          </p>
        )}
      </Tile>

      <Tile
        title={t("overview.health")}
        icon={CircleAlert}
        actions={
          withIssues.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => browse({ flags: ["issues"] })}>
              {t("overview.showInLibrary")}
            </Button>
          )
        }
      >
        <Big
          value={withIssues.length || t("overview.none")}
          tone={withIssues.length ? "text-danger" : undefined}
          label={withIssues.length ? t("overview.withIssues", { count: withIssues.length }) : t("overview.noIssues")}
        />
        {withIssues.length > 0 && <p className="mt-1 line-clamp-2 text-xs text-muted">{issueText(withIssues[0].issues[0])}</p>}
      </Tile>

      <Tile
        title={t("overview.changed")}
        icon={FolderSymlink}
        actions={
          moved + removed > 0 && (
            <Button size="sm" onClick={() => setScreen("cleanup")}>
              {t("overview.openCleanUp")}
            </Button>
          )
        }
      >
        <Big
          value={moved + removed || t("overview.none")}
          label={moved + removed ? t("overview.changedCounts", { moved, removed }) : t("overview.noChanges")}
        />
      </Tile>

      <Tile
        title={t("rail.library")}
        icon={LibraryBig}
        actions={
          <Button variant="ghost" size="sm" onClick={() => browse({})}>
            {t("overview.openLibrary")}
          </Button>
        }
      >
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[13px]">
          <dt className="text-muted">{t("overview.plugins")}</dt>
          <dd className="text-right font-mono tabular-nums">{plugins.length}</dd>
          <dt className="text-muted">{t("overview.turnedOff")}</dt>
          <dd className="text-right font-mono tabular-nums">{off}</dd>
          <dt className="text-muted">{t("overview.skills")}</dt>
          <dd className="text-right font-mono tabular-nums">{items.length - plugins.length}</dd>
        </dl>
      </Tile>
    </div>
  );
}
