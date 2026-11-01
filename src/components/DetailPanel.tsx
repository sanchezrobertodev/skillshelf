import clsx from "clsx";
import { Bot, Copy, Download, ExternalLink, FolderOpen, Hammer, Plug, Power, PowerOff, RotateCcw, ScrollText, SquareTerminal, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api";
import { type TKey, useT } from "../i18n";
import { showsChangelog } from "../lib/changelog";
import { canReinstall, canToggle, canUninstall, canUpdate, fullDate, kindLabel, sourceHelp, sourceLabel } from "../lib/format";
import { useStore } from "../store";
import type { Child, Item } from "../types";
import { ChangelogPanel } from "./Changelog";
import { CostSection, IssueList, LastRunSection, ReadmeSection, UpstreamNote, UsageSection } from "./DetailSections";
import { Button, card, IconButton, KindIcon, StatusBadge } from "./ui";

const childMeta: Record<Child["kind"], { label: TKey; icon: typeof Bot }> = {
  skill: { label: "detail.children.skill", icon: ScrollText },
  command: { label: "detail.children.command", icon: SquareTerminal },
  agent: { label: "detail.children.agent", icon: Bot },
  mcp: { label: "detail.children.mcp", icon: Plug },
  hook: { label: "detail.children.hook", icon: Hammer },
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
  const t = useT();
  const busy = useStore((s) => s.busy);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const closeDetail = useStore((s) => s.closeDetail);
  const jobs = useStore((s) => s.jobs);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mine = Object.values(jobs).filter((j) => j.itemId === item.id);
  const running = mine.some((j) => j.state === "queued" || j.state === "running");
  const finished = mine.length - mine.filter((j) => j.state === "queued" || j.state === "running").length;
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
      setError(t("detail.copyFailed"));
    }
  };

  return (
    <aside
      aria-label={t("detail.label", { name: item.name })}
      className={clsx(
        "flex w-[380px] shrink-0 flex-col overflow-hidden",
        card,
        overlay && "absolute top-0 right-5 bottom-4 z-30 shadow-2xl",
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
            {item.enabled === false && <span className="text-xs text-muted">{t("detail.disabled")}</span>}
          </div>
        </div>
        <IconButton label={t("detail.close")} onClick={closeDetail} className="-mt-1 -mr-2">
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {item.statusDetail && item.status !== "upToDate" && !item.upstream && (
          <p className="mb-3 text-[13px] text-muted">{item.statusDetail}</p>
        )}
        <UpstreamNote item={item} onError={setError} />

        <div className="mb-5 flex flex-wrap gap-2">
          {canUpdate(item) && (
            <Button
              size="sm"
              variant={item.status === "updateAvailable" ? "primary" : "secondary"}
              disabled={running}
              onClick={() => confirm({ type: "update", items: [item] })}
            >
              <Download aria-hidden className="size-3.5" />
              {item.status === "updateAvailable" ? t("detail.updateTo", { version: item.latest ?? t("detail.latestVersion") }) : t("detail.update")}
            </Button>
          )}
          {canReinstall(item) && (
            <Button size="sm" variant="primary" disabled={running} onClick={() => void run([{ itemId: item.id, action: "reinstall" }])}>
              <RotateCcw aria-hidden className="size-3.5" />
              {t("detail.reinstall")}
            </Button>
          )}
          {canToggle(item) && (
            <Button
              size="sm"
              disabled={running}
              onClick={() => void run([{ itemId: item.id, action: item.enabled ? "disable" : "enable" }])}
            >
              {item.enabled ? <PowerOff aria-hidden className="size-3.5" /> : <Power aria-hidden className="size-3.5" />}
              {item.enabled ? t("detail.disable") : t("detail.enable")}
            </Button>
          )}
          {item.path && (
            <Button size="sm" onClick={() => attempt(() => api.openFolder(item.id))}>
              <FolderOpen aria-hidden className="size-3.5" />
              {t("detail.openFolder")}
            </Button>
          )}
          {item.repoUrl && (
            <Button size="sm" onClick={() => attempt(() => api.openRepo(item.id))}>
              <ExternalLink aria-hidden className="size-3.5" />
              {t("detail.repo")}
            </Button>
          )}
          {canUninstall(item) && (
            <Button size="sm" variant="danger" disabled={running} onClick={() => confirm({ type: "uninstall", items: [item] })}>
              <Trash2 aria-hidden className="size-3.5" />
              {t("detail.uninstall")}
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

        <IssueList item={item} />

        {item.status === "updateAvailable" && <ChangelogPanel key={item.id} item={item} />}

        <CostSection item={item} />
        <UsageSection item={item} />

        <dl className="mb-6 grid grid-cols-[104px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <Fact label={t("detail.type")}>{kindLabel[item.kind]}</Fact>
          <Fact label={t("detail.source")}>
            <span title={sourceHelp[item.source]}>{sourceLabel[item.source]}</span>
          </Fact>
          {item.origin && <Fact label={item.kind === "plugin" ? t("source.marketplace") : t("detail.from")} mono>{item.origin}</Fact>}
          {item.scope && <Fact label={t("detail.scope")}>{item.scope}</Fact>}
          <Fact label={t("detail.version")} mono>
            {item.version ?? "—"}
          </Fact>
          {item.latest && <Fact label={t("detail.latest")} mono>{item.latest}</Fact>}
          {item.installedAt && <Fact label={t("detail.installed")}>{fullDate(item.installedAt)}</Fact>}
          {item.updatedAt && item.updatedAt !== item.installedAt && <Fact label={t("detail.updated")}>{fullDate(item.updatedAt)}</Fact>}
          {Object.entries(item.meta).map(([k, v]) => (
            <Fact key={k} label={k} mono>
              {v}
            </Fact>
          ))}
        </dl>

        {item.path && (
          <div className="mb-6">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{t("detail.location")}</h3>
            <div className="flex items-start gap-1 rounded-md border border-border bg-bg p-2">
              <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{item.path}</code>
              <IconButton label={copied ? t("detail.copied") : t("detail.copyPath")} className="size-7" onClick={() => void copyPath()}>
                <Copy className="size-3.5" />
              </IconButton>
            </div>
          </div>
        )}

        <ReadmeSection key={item.id} item={item} />
        <LastRunSection item={item} finished={finished} />

        {item.status !== "updateAvailable" && showsChangelog(item) && <ChangelogPanel key={item.id} item={item} />}

        {groups.map(({ kind, list }) => {
          const { label, icon: Icon } = childMeta[kind];
          return (
            <section key={kind} className="mb-5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                <Icon aria-hidden className="size-3.5" />
                {t(label)} <span className="font-mono">{list.length}</span>
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
