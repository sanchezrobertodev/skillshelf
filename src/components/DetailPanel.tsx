import clsx from "clsx";
import { Bot, Copy, Download, ExternalLink, FolderOpen, Hammer, Plug, Power, PowerOff, ScrollText, SquareTerminal, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api";
import { canToggle, canUninstall, canUpdate, fullDate, kindLabel, sourceHelp, sourceLabel } from "../lib/format";
import { useStore } from "../store";
import type { Child, Item } from "../types";
import { Button, IconButton, KindIcon, StatusBadge } from "./ui";

const childMeta: Record<Child["kind"], { label: string; icon: typeof Bot }> = {
  skill: { label: "Skills", icon: ScrollText },
  command: { label: "Commands", icon: SquareTerminal },
  agent: { label: "Agents", icon: Bot },
  mcp: { label: "MCP servers", icon: Plug },
  hook: { label: "Hooks", icon: Hammer },
};

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={clsx("min-w-0 break-words", mono && "font-mono text-xs leading-5")}>{children}</dd>
    </>
  );
}

export function DetailPanel({ item, overlay }: { item: Item; overlay: boolean }) {
  const busy = useStore((s) => s.busy);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const closeDetail = useStore((s) => s.closeDetail);
  const jobs = useStore((s) => s.jobs);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const running = Object.values(jobs).some((j) => j.itemId === item.id && (j.state === "queued" || j.state === "running"));
  const groups = (Object.keys(childMeta) as Child["kind"][])
    .map((k) => ({ kind: k, list: item.children.filter((c) => c.kind === k) }))
    .filter((g) => g.list.length);

  const attempt = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e) => setError(errorText(e)));
  };

  const copyPath = async () => {
    if (!item.path) return;
    try {
      await navigator.clipboard.writeText(item.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard");
    }
  };

  return (
    <aside
      aria-label={`${item.name} details`}
      className={clsx(
        "flex w-[380px] shrink-0 flex-col border-l border-border bg-surface",
        overlay && "absolute inset-y-0 right-0 z-30 shadow-2xl",
      )}
    >
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <KindIcon kind={item.kind} className="mt-1 size-5" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" title={item.name}>
            {item.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={item.status} checking={busy === "checking"} />
            {item.enabled === false && <span className="text-xs text-muted">Disabled</span>}
          </div>
        </div>
        <IconButton label="Close details" onClick={closeDetail} className="-mt-1 -mr-2">
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {item.statusDetail && item.status !== "upToDate" && (
          <p className="mb-3 text-[13px] text-muted">{item.statusDetail}</p>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          {canUpdate(item) && (
            <Button
              size="sm"
              variant={item.status === "updateAvailable" ? "primary" : "secondary"}
              disabled={running}
              onClick={() => void run([{ itemId: item.id, action: "update" }])}
            >
              <Download aria-hidden className="size-3.5" />
              {item.status === "updateAvailable" ? `Update to ${item.latest ?? "latest"}` : "Update"}
            </Button>
          )}
          {canToggle(item) && (
            <Button
              size="sm"
              disabled={running}
              onClick={() => void run([{ itemId: item.id, action: item.enabled ? "disable" : "enable" }])}
            >
              {item.enabled ? <PowerOff aria-hidden className="size-3.5" /> : <Power aria-hidden className="size-3.5" />}
              {item.enabled ? "Disable" : "Enable"}
            </Button>
          )}
          {item.path && (
            <Button size="sm" onClick={() => attempt(() => api.openFolder(item.id))}>
              <FolderOpen aria-hidden className="size-3.5" />
              Open folder
            </Button>
          )}
          {item.repoUrl && (
            <Button size="sm" onClick={() => attempt(() => api.openRepo(item.id))}>
              <ExternalLink aria-hidden className="size-3.5" />
              Source
            </Button>
          )}
          {canUninstall(item) && (
            <Button size="sm" variant="danger" disabled={running} onClick={() => confirm({ type: "uninstall", items: [item] })}>
              <Trash2 aria-hidden className="size-3.5" />
              Uninstall
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        {item.description && <p className="mb-5 text-[13px] leading-relaxed">{item.description}</p>}

        {item.notes.length > 0 && (
          <ul className="mb-5 space-y-2">
            {item.notes.map((n) => (
              <li key={n} className="flex gap-2 rounded-md border border-warn/35 bg-warn/10 px-3 py-2 text-[13px]">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                {n}
              </li>
            ))}
          </ul>
        )}

        <dl className="mb-6 grid grid-cols-[104px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <Fact label="Type">{kindLabel[item.kind]}</Fact>
          <Fact label="Source">
            <span title={sourceHelp[item.source]}>{sourceLabel[item.source]}</span>
          </Fact>
          {item.origin && <Fact label={item.kind === "plugin" ? "Marketplace" : "From"} mono>{item.origin}</Fact>}
          {item.scope && <Fact label="Scope">{item.scope}</Fact>}
          <Fact label="Version" mono>
            {item.version ?? "—"}
          </Fact>
          {item.latest && <Fact label="Latest" mono>{item.latest}</Fact>}
          {item.installedAt && <Fact label="Installed">{fullDate(item.installedAt)}</Fact>}
          {item.updatedAt && item.updatedAt !== item.installedAt && <Fact label="Updated">{fullDate(item.updatedAt)}</Fact>}
          {Object.entries(item.meta).map(([k, v]) => (
            <Fact key={k} label={k} mono>
              {v}
            </Fact>
          ))}
        </dl>

        {item.path && (
          <div className="mb-6">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Location</h3>
            <div className="flex items-start gap-1 rounded-md border border-border bg-bg p-2">
              <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{item.path}</code>
              <IconButton label={copied ? "Copied" : "Copy path"} className="size-7" onClick={() => void copyPath()}>
                <Copy className="size-3.5" />
              </IconButton>
            </div>
          </div>
        )}

        {groups.map(({ kind, list }) => {
          const { label, icon: Icon } = childMeta[kind];
          return (
            <section key={kind} className="mb-5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                <Icon aria-hidden className="size-3.5" />
                {label} <span className="font-mono">{list.length}</span>
              </h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {list.map((c) => (
                  <li key={c.name} className="px-3 py-2">
                    <div className="font-mono text-xs font-medium">{c.name}</div>
                    {c.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{c.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
