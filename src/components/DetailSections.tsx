import clsx from "clsx";
import { ChevronRight, CircleAlert, FileText, FolderSymlink, Gauge, History, LoaderCircle, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { locale, tx, type TKey, useT } from "../i18n";
import { issueText, relativeTime } from "../lib/format";
import { hasHooks, loadsEverywhere } from "../lib/insights";
import { useStore } from "../store";
import type { Item, LastRun, Readme } from "../types";
import { Markdown } from "./Markdown";
import { Sparkline } from "./Sparkline";

const heading = "mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase";
const PARTS_SHOWN = 8;

/** Where a moved skill lives now, or the commit that deleted it. */
export function UpstreamNote({ item, onError }: { item: Item; onError: (e: string) => void }) {
  useT();
  const up = item.upstream;
  if (!up || (item.status !== "moved" && item.status !== "removed")) return null;
  const commit = up.commit;
  return (
    <div className="mb-5 flex gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px]">
      <FolderSymlink aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
      {item.status === "moved" ? (
        <p>
          {tx("detail.movedTo", {
            path: <span className="font-mono text-xs break-all">{up.folder ? `${up.repo}/${up.folder}` : up.repo}</span>,
          })}
        </p>
      ) : (
        <p>
          {tx("detail.removedFrom", {
            repo: <span className="font-mono text-xs">{up.repo}</span>,
            commit: commit && (
              <>
                {" "}
                {tx("detail.removedIn", {
                  sha: commit.url ? (
                    <button
                      type="button"
                      onClick={() => api.openChangelogLink(item.id, commit.url!).catch((e) => onError(errorText(e)))}
                      className="rounded font-mono text-xs text-info hover:underline"
                    >
                      {commit.sha.slice(0, 7)}
                    </button>
                  ) : (
                    <span className="font-mono text-xs">{commit.sha.slice(0, 7)}</span>
                  ),
                })}
                {commit.date && ` ${relativeTime(commit.date)}`}
                {commit.message && <span className="block text-xs text-muted">{commit.message}</span>}
              </>
            ),
          })}
        </p>
      )}
    </div>
  );
}

export function IssueList({ item }: { item: Item }) {
  const t = useT();
  if (!item.issues.length) return null;
  return (
    <section aria-label={t("detail.problems")} className="mb-5">
      <ul className="space-y-2">
        {item.issues.map((i) => (
          <li key={i.code + i.message} className="flex gap-2 rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-[13px]">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            {issueText(i)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CostSection({ item }: { item: Item }) {
  const t = useT();
  const cost = item.cost;
  if (!cost) return null;
  const parts = [...cost.parts].sort((a, b) => b.tokens - a.tokens);
  const max = Math.max(1, ...parts.map((p) => p.tokens));
  const where: TKey = item.enabled === false ? "detail.costWhenOn" : loadsEverywhere(item) ? "detail.costSession" : "detail.costProject";
  return (
    <section className="mb-6">
      <h3 className={heading}>
        <Gauge aria-hidden className="size-3.5" />
        {t("detail.cost")}
      </h3>
      <p className="text-[13px]">
        {tx(where, { total: <span className="font-mono font-medium">≈{cost.total.toLocaleString(locale())}</span> })}
      </p>
      {parts.length > 1 && (
        <ul className="mt-2 space-y-1">
          {parts.slice(0, PARTS_SHOWN).map((p) => (
            <li key={p.kind + p.name} className="grid grid-cols-[1fr_56px_44px] items-center gap-2 text-xs">
              <span className="truncate font-mono" title={`${t(`detail.part.${p.kind}`)}: ${p.name}`}>
                {p.name}
              </span>
              <span aria-hidden className="h-1.5 rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(p.tokens / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-muted tabular-nums">{p.tokens}</span>
            </li>
          ))}
          {parts.length > PARTS_SHOWN && <li className="text-xs text-muted">{t("detail.costMore", { count: parts.length - PARTS_SHOWN })}</li>}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">{t("detail.costHelp")}</p>
    </section>
  );
}

export function UsageSection({ item }: { item: Item }) {
  const t = useT();
  const usage = useStore((s) => s.usage);
  const progress = useStore((s) => s.usageProgress);
  const u = usage?.[item.id];
  return (
    <section className="mb-6">
      <h3 className={heading}>
        <Activity aria-hidden className="size-3.5" />
        {t("detail.usage")}
      </h3>
      {!usage ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          {progress?.total ? t("detail.countingProgress", { read: progress.read, total: progress.total }) : t("detail.counting")}
        </p>
      ) : (
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1 text-[13px]">
            <p>{tx("detail.uses", { count: u?.uses ?? 0, uses: <span className="font-mono font-medium">{u?.uses ?? 0}</span> })}</p>
            <p className="text-xs text-muted">{u?.lastUsed ? t("detail.lastUsed", { time: relativeTime(u.lastUsed) }) : t("detail.noUses")}</p>
          </div>
          {u && <Sparkline daily={u.daily} className="h-7 w-[120px] shrink-0" />}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        {t("detail.usageHelp")}
        {hasHooks(item) && ` ${t("detail.usageHooks")}`}
      </p>
    </section>
  );
}

/** SKILL.md or README.md, loaded when opened. Render with `key={item.id}` so another item starts closed. */
export function ReadmeSection({ item }: { item: Item }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<Readme | null | "loading" | { error: string }>(null);
  useEffect(() => {
    if (!open || doc) return;
    setDoc("loading");
    api.readme(item.id).then(
      (r) => setDoc(r ?? { error: item.kind === "skill" ? t("detail.noSkillMd") : t("detail.noReadme") }),
      (e) => setDoc({ error: errorText(e) }),
    );
  }, [open, doc, item.id, item.kind]);
  if (!item.path) return null;
  const name = item.kind === "skill" ? "SKILL.md" : "README";
  return (
    <section className="mb-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={clsx(heading, "-mx-1 rounded px-1 transition-colors duration-150 hover:text-fg")}
      >
        <ChevronRight aria-hidden className={clsx("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        <FileText aria-hidden className="size-3.5" />
        {name}
      </button>
      {open && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-border bg-bg p-3">
          {doc === "loading" || doc === null ? (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {t("detail.loading")}
            </p>
          ) : "error" in doc ? (
            <p className="text-xs text-muted">{doc.error}</p>
          ) : (
            <>
              <Markdown text={doc.text} className="text-[13px]" />
              {doc.truncated && <p className="mt-2 text-xs text-muted">{t("detail.readmeTruncated")}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const runLabel: Record<LastRun["state"], TKey> = {
  success: "detail.run.success",
  failed: "detail.run.failed",
  needsConfirmation: "detail.run.needsConfirmation",
  cancelled: "detail.run.cancelled",
};
const actionLabel: Record<LastRun["action"], TKey> = {
  update: "detail.update",
  enable: "detail.action.enable",
  disable: "detail.action.disable",
  uninstall: "detail.uninstall",
  reinstall: "detail.reinstall",
};

/** The last action's output, kept across restarts. `finished` changes when one of the item's jobs ends. */
export function LastRunSection({ item, finished }: { item: Item; finished: number }) {
  const t = useT();
  const [run, setRun] = useState<LastRun | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    api.lastRuns().then(
      (r) => live && setRun(r[item.id] ?? null),
      () => live && setRun(null),
    );
    return () => {
      live = false;
    };
  }, [item.id, finished]);
  if (!run) return null;
  return (
    <section className="mb-6">
      <h3 className={heading}>
        <History aria-hidden className="size-3.5" />
        {t("detail.lastAction")}
      </h3>
      <p className="text-[13px]">
        {t(actionLabel[run.action])}: <span className={clsx(run.state === "failed" && "text-danger")}>{t(runLabel[run.state])}</span>
        <span className="text-xs text-muted"> · {relativeTime(run.finishedAt)}</span>
      </p>
      {run.message && <p className="text-xs text-muted">{run.message}</p>}
      {run.lines.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="mt-1 -ml-1 flex items-center gap-1 rounded px-1 text-xs font-medium text-muted hover:text-fg"
          >
            <ChevronRight aria-hidden className={clsx("size-3.5 transition-transform duration-150", open && "rotate-90")} />
            {open ? t("detail.hideOutput") : t("detail.showOutput", { count: run.lines.length })}
          </button>
          {open && (
            <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted">
              {run.lines.join("\n")}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
