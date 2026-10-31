import clsx from "clsx";
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
import { relativeTime } from "../lib/format";
import { isUnused, loadsEverywhere, sessionTokens, shortCount } from "../lib/insights";
import { updatable, useStore } from "../store";
import { Button, card } from "./ui";
import { mcpMeta } from "./McpServers";

const TOP = 5;

function Tile({ title, icon: Icon, children, actions }: { title: string; icon: typeof Gauge; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={clsx(card, "flex flex-col p-4")}>
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
      <span className={clsx("block text-3xl font-semibold tracking-tight tabular-nums", tone)}>{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </p>
  );
}

export function Overview() {
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
      <div className={clsx(card, "mx-5 mb-4 flex flex-1 items-center justify-center gap-2 text-[13px] text-muted")}>
        {busy === "scanning" ? (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Scanning installed items…
          </>
        ) : (
          "No skills or plugins found in ~/.claude."
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
        title="Updates"
        icon={CircleArrowUp}
        actions={
          pending.length ? (
            <>
              <Button variant="update" size="sm" onClick={() => confirm({ type: "update", items: pending })}>
                <Download aria-hidden className="size-3.5" />
                Review {pending.length}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => browse({ statuses: ["updateAvailable"] })}>
                Show in Library
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy !== "idle"} onClick={() => void checkUpdates()}>
              <RefreshCw aria-hidden className={clsx("size-3.5", busy === "checking" && "animate-spin")} />
              Check now
            </Button>
          )
        }
      >
        <Big
          value={pending.length || "None"}
          tone={pending.length ? "text-warn" : undefined}
          label={pending.length ? (pending.length === 1 ? "update pending" : "updates pending") : "Everything is up to date"}
        />
        <p className="mt-1 text-xs text-muted">{checkedAt ? `Checked ${relativeTime(checkedAt)}` : "Not checked yet"}</p>
      </Tile>

      <Tile
        title="Context per session"
        icon={Gauge}
        actions={
          <Button variant="ghost" size="sm" onClick={byCost}>
            Sort Library by cost
          </Button>
        }
      >
        <Big value={`≈${shortCount(tokens)}`} label="tokens added to every session (estimate)" />
        {heavy.length > 0 && (
          <ol aria-label="Heaviest items" className="mt-3 space-y-1.5">
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
        title="Unused plugins"
        icon={BrushCleaning}
        actions={
          unused && (
            <Button size="sm" onClick={() => setScreen("cleanup")}>
              Open Clean Up
            </Button>
          )
        }
      >
        {unused ? (
          <>
            <Big value={unused.length} label={unused.length === 1 ? "enabled plugin with no uses in 30 days" : "enabled plugins with no uses in 30 days"} />
            {unusedTokens > 0 && <p className="mt-1 text-xs text-muted">Turning them off frees ≈{shortCount(unusedTokens)} tokens per session.</p>}
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {progress?.total ? `Counting uses: ${progress.read} of ${progress.total} transcripts…` : "Counting uses from your transcripts…"}
          </p>
        )}
      </Tile>

      <Tile
        title="MCP servers"
        icon={Server}
        actions={
          mcp ? (
            <Button size="sm" onClick={() => setScreen("mcp")}>
              Open MCP Servers
            </Button>
          ) : (
            <Button size="sm" disabled={mcpBusy} onClick={() => void loadMcp()}>
              {mcpBusy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
              {mcpBusy ? "Checking…" : "Check servers"}
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
                  ? `of ${mcp.servers.length} servers need attention`
                  : mcp.servers.length === 1
                    ? "server, connected"
                    : "servers, all connected"
              }
            />
            {problems.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {problems.slice(0, 3).map((s) => (
                  <li key={`${s.plugin}:${s.name}`} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                    <span className="shrink-0 text-muted">{mcpMeta[s.state].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[13px] text-muted">
            {mcpBusy
              ? "Connecting to each server. This takes 30–60 seconds."
              : "Not checked yet. Checking starts each server through claude mcp list, which takes 30–60 seconds."}
          </p>
        )}
      </Tile>

      <Tile
        title="Skill health"
        icon={CircleAlert}
        actions={
          withIssues.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => browse({ flags: ["issues"] })}>
              Show in Library
            </Button>
          )
        }
      >
        <Big
          value={withIssues.length || "None"}
          tone={withIssues.length ? "text-danger" : undefined}
          label={withIssues.length ? (withIssues.length === 1 ? "skill with problems" : "skills with problems") : "No problems found in your skills"}
        />
        {withIssues.length > 0 && <p className="mt-1 line-clamp-2 text-xs text-muted">{withIssues[0].issues[0].message}</p>}
      </Tile>

      <Tile
        title="Changed upstream"
        icon={FolderSymlink}
        actions={
          moved + removed > 0 && (
            <Button size="sm" onClick={() => setScreen("cleanup")}>
              Open Clean Up
            </Button>
          )
        }
      >
        <Big
          value={moved + removed || "None"}
          label={moved + removed ? `${moved} moved, ${removed} removed upstream` : "No skills moved or removed upstream"}
        />
      </Tile>

      <Tile
        title="Library"
        icon={LibraryBig}
        actions={
          <Button variant="ghost" size="sm" onClick={() => browse({})}>
            Open Library
          </Button>
        }
      >
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[13px]">
          <dt className="text-muted">Plugins</dt>
          <dd className="text-right font-mono tabular-nums">{plugins.length}</dd>
          <dt className="text-muted">Turned off</dt>
          <dd className="text-right font-mono tabular-nums">{off}</dd>
          <dt className="text-muted">Skills</dt>
          <dd className="text-right font-mono tabular-nums">{items.length - plugins.length}</dd>
        </dl>
      </Tile>
    </div>
  );
}
