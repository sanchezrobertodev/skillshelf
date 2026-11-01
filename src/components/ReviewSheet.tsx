import clsx from "clsx";
import { ChevronRight, Download, FileCode, LoaderCircle, Plug, ShieldCheck, Webhook, Wrench } from "lucide-react";
import { useId, useRef, useState } from "react";
import { api, errorText } from "../api";
import { type TKey, tx, useT } from "../i18n";
import { changelogCounts, isEmpty, newestChange, useChangelog } from "../lib/changelog";
import { relativeTime, riskText } from "../lib/format";
import { useStore } from "../store";
import type { Item, Risk } from "../types";
import { Button, KindIcon, Modal } from "./ui";

/** Changelogs are looked up for this many items at once, to go easy on the GitHub rate limit; the rest have a button. */
const LOOKUPS = 10;
const FILES_SHOWN = 8;

const riskMeta: Record<Risk["kind"], { label: TKey; icon: typeof Webhook }> = {
  hooks: { label: "review.risk.hooks", icon: Webhook },
  mcp: { label: "review.risk.mcp", icon: Plug },
  scripts: { label: "review.risk.scripts", icon: FileCode },
  allowedTools: { label: "review.risk.allowedTools", icon: Wrench },
};

/** A flag with its reason and files, shown on hover or keyboard focus. Fixed position so the sheet's scroll area can't clip it. */
function RiskChip({ risk }: { risk: Risk }) {
  const t = useT();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const { label, icon: Icon } = riskMeta[risk.kind];
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
    setAt(r.bottom + 200 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  const hide = () => setAt(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => (at ? hide() : show())}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-warn/35 bg-warn/12 px-2 text-xs font-medium text-warn"
      >
        <Icon aria-hidden className="size-3.5" />
        {t(label)}
      </button>
      <span
        id={id}
        role="tooltip"
        style={at ?? undefined}
        className={clsx("fixed z-50 w-80 rounded-lg border border-border bg-surface p-3 text-xs shadow-card", !at && "hidden")}
      >
        <span className="block text-fg">{riskText(risk)}</span>
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted">
          {risk.files.slice(0, FILES_SHOWN).map((f) => (
            <li key={f} className="truncate">
              {f}
            </li>
          ))}
          {risk.files.length > FILES_SHOWN && <li>{t("review.moreFiles", { count: risk.files.length - FILES_SHOWN })}</li>}
        </ul>
      </span>
    </>
  );
}

function Changes({ item, lookup, onError }: { item: Item; lookup: boolean; onError: (e: string) => void }) {
  const t = useT();
  const [wanted, setWanted] = useState(lookup);
  const [open, setOpen] = useState(false);
  const { state, retry } = useChangelog(item, wanted);

  if (!wanted)
    return (
      <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => setWanted(true)}>
        {t("review.lookUp")}
      </Button>
    );
  if (state.status === "idle" || state.status === "loading")
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <LoaderCircle aria-hidden className="size-3 animate-spin" />
        {t("review.lookingUp")}
      </p>
    );
  if (state.status === "error")
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        {t("review.lookupFailed")}
        <button type="button" onClick={retry} className="rounded font-medium text-accent hover:underline">
          {t("review.tryAgain")}
        </button>
      </p>
    );

  const log = state.log;
  const counts = changelogCounts(log);
  const newest = newestChange(log);
  return (
    <div className="space-y-1.5">
      {(counts || log.installed) && (
        <p className="text-xs text-muted">
          {counts}
          {counts && log.installed && " · "}
          {log.installed && tx("review.sinceVersion", { sha: <span className="font-mono">{log.installed.sha.slice(0, 7)}</span> })}
        </p>
      )}
      {isEmpty(log) && <p className="text-xs text-muted">{log.note ?? t("review.noChangelog")}</p>}
      {newest && (
        <p className="line-clamp-1 text-xs" title={newest}>
          {t("review.latest", { change: newest })}
        </p>
      )}
      {log.risks === null ? (
        <p className="text-xs text-muted">{t("review.risksFailed")}</p>
      ) : log.risks.length ? (
        <ul aria-label={t("review.risksLabel")} className="flex flex-wrap gap-1.5">
          {log.risks.map((r) => (
            <li key={r.kind}>
              <RiskChip risk={r} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted">
          <ShieldCheck aria-hidden className="size-3.5" />
          {t("review.noRisks")}
        </p>
      )}
      {log.entries.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="-ml-1 flex items-center gap-1 rounded px-1 text-xs font-medium text-muted hover:text-fg"
          >
            <ChevronRight aria-hidden className={clsx("size-3.5 transition-transform duration-150", open && "rotate-90")} />
            {open ? t("review.hideCommits") : t("review.showCommits", { count: log.entries.length })}
          </button>
          {open && (
            <ol className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-bg p-2">
              {log.entries.map((e) => (
                <li key={e.sha} className="flex gap-2 text-xs">
                  {e.url ? (
                    <button
                      type="button"
                      onClick={() => api.openChangelogLink(item.id, e.url!).catch((err) => onError(errorText(err)))}
                      className="shrink-0 rounded font-mono text-accent hover:underline"
                      aria-label={t("review.openCommit", { sha: e.sha.slice(0, 7) })}
                    >
                      {e.sha.slice(0, 7)}
                    </button>
                  ) : (
                    <span className="shrink-0 font-mono text-muted">{e.sha.slice(0, 7)}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={e.message}>
                    {e.message}
                  </span>
                  {e.date && <span className="shrink-0 text-muted">{relativeTime(e.date)}</span>}
                </li>
              ))}
              {log.total > log.entries.length && (
                <li className="text-xs text-muted">{t("review.andMore", { count: log.total - log.entries.length })}</li>
              )}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** Confirms updates: untick to skip, with what changed and what now runs without asking for each. */
export function ReviewSheet({ items }: { items: Item[] }) {
  const t = useT();
  const confirm = useStore((s) => s.confirm);
  const run = useStore((s) => s.run);
  const [ticked, setTicked] = useState(() => new Set(items.map((i) => i.id)));
  const [error, setError] = useState<string | null>(null);
  const close = () => confirm(null);
  const many = items.length > 1;
  const chosen = items.filter((i) => ticked.has(i.id));
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Modal
      wide
      title={many ? t("review.title", { count: items.length }) : t("review.titleOne", { name: items[0].name })}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t("common.cancel")}</Button>
          <Button
            data-autofocus
            variant="primary"
            disabled={!chosen.length}
            onClick={() => {
              close();
              void run(chosen.map((i) => ({ itemId: i.id, action: "update" as const })));
            }}
          >
            <Download aria-hidden className="size-4" />
            {!many
              ? t("review.update")
              : chosen.length === items.length
                ? t("review.updateAll", { count: items.length })
                : t("review.updateSome", { done: chosen.length, total: items.length })}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((i, idx) => (
          <li key={i.id} className="flex gap-3 px-3 py-2.5">
            {many && (
              <input
                type="checkbox"
                aria-label={t("review.updateItem", { name: i.name })}
                checked={ticked.has(i.id)}
                onChange={() => toggle(i.id)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
              />
            )}
            <KindIcon kind={i.kind} className="mt-0.5 size-4" />
            <div className={clsx("min-w-0 flex-1 space-y-1", many && !ticked.has(i.id) && "opacity-60")}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium">
                <span className="truncate">{i.name}</span>
                <span className="font-mono text-xs font-normal text-muted">
                  {i.version ?? "?"} → {i.latest ?? t("review.latestVersion")}
                </span>
              </div>
              {i.status === "updateAvailable" ? (
                <Changes item={i} lookup={idx < LOOKUPS} onError={setError} />
              ) : (
                <p className="text-xs text-muted">{t("review.noUpdate")}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {items.some((i) => i.kind === "plugin") && (
        <p className="mt-3 text-xs text-muted">{t("review.restart")}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
