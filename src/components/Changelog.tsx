import { ChevronRight, ExternalLink, GitCommitHorizontal, History, Info, LoaderCircle, RotateCw } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../api";
import { tx, useT } from "../i18n";
import { isEmpty, useChangelog } from "../lib/changelog";
import { cx } from "../lib/cx";
import { fullDate, relativeTime } from "../lib/format";
import type { Changelog, ChangelogSection, Item } from "../types";
import { Link, Markdown, type OpenLink } from "./Markdown";
import { Button } from "./ui";

const COMMITS_SHOWN = 8;
const SECTIONS_SHOWN = 3;

function Releases({ sections, label, onOpen }: { sections: ChangelogSection[]; label: string | null; onOpen: OpenLink }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? sections : sections.slice(0, SECTIONS_SHOWN);
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs text-muted">
        {label ? tx("changelog.releaseNotesFrom", { label: <span className="font-mono">{label}</span> }) : t("changelog.releaseNotes")}
      </p>
      <div className="divide-y divide-border rounded-md border border-border">
        {shown.map((s, i) => (
          <details key={`${s.version}-${i}`} open={i === 0} className="group">
            <summary className="flex list-none items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors duration-150 hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted transition-transform duration-150 group-open:rotate-90" />
              <span className="min-w-0 truncate font-mono text-xs">{s.title}</span>
            </summary>
            <div className="px-3 pt-0.5 pb-2.5">
              {s.body ? <Markdown text={s.body} onOpen={onOpen} className="text-xs" /> : <p className="text-xs text-muted">{t("changelog.noNotes")}</p>}
            </div>
          </details>
        ))}
      </div>
      {sections.length > SECTIONS_SHOWN && (
        <Button size="sm" variant="ghost" className="mt-1 -ml-2.5 text-muted" onClick={() => setAll(!all)}>
          {all ? t("changelog.fewerReleases") : t("changelog.moreReleases", { count: sections.length - SECTIONS_SHOWN })}
        </Button>
      )}
    </div>
  );
}

function Commits({ log, onOpen }: { log: Changelog; onOpen: OpenLink }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? log.entries : log.entries.slice(0, COMMITS_SHOWN);
  const hidden = log.total - log.entries.length;
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs text-muted">{log.label}</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {shown.map((e) => (
          <li key={e.sha} className="flex gap-2 px-3 py-2">
            <GitCommitHorizontal aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              {e.url ? (
                <Link url={e.url} onOpen={onOpen} className="line-clamp-2 text-xs text-fg">
                  {e.message || t("changelog.noMessage")}
                </Link>
              ) : (
                <p className="line-clamp-2 text-xs">{e.message || t("changelog.noMessage")}</p>
              )}
              <p className="mt-0.5 font-mono text-[11px] text-muted">
                {e.sha.slice(0, 7)}
                {e.date && (
                  <span title={fullDate(e.date)}>
                    {" · "}
                    {relativeTime(e.date)}
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {log.entries.length > COMMITS_SHOWN && (
        <Button size="sm" variant="ghost" className="mt-1 -ml-2.5 text-muted" onClick={() => setAll(!all)}>
          {all ? t("changelog.fewerCommits") : t("changelog.allCommits", { count: log.entries.length })}
        </Button>
      )}
      {hidden > 0 && <p className="mt-1 text-xs text-muted">{t("changelog.olderCommits", { count: hidden })}</p>}
    </div>
  );
}

export function ChangelogPanel({ item }: { item: Item }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { state, retry } = useChangelog(item, open);
  const onOpen: OpenLink = (url) => {
    setLinkError(null);
    api.openChangelogLink(item.id, url).catch((e) => setLinkError(errorText(e)));
  };

  return (
    <section className="mb-6" aria-label={t("changelog.title")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1 mb-1.5 flex items-center gap-1.5 rounded px-1 text-[11px] font-semibold tracking-wider text-muted uppercase transition-colors duration-150 hover:text-fg"
      >
        <ChevronRight aria-hidden className={cx("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        <History aria-hidden className="size-3.5" />
        {t("changelog.title")}
      </button>

      {open && (
        <div aria-live="polite">
          {(state.status === "loading" || state.status === "idle") && (
            <p className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-xs text-muted">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {t("changelog.loading")}
            </p>
          )}
          {state.status === "error" && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <p>{t("changelog.loadFailed", { error: state.error })}</p>
              <Button size="sm" className="mt-2" onClick={retry}>
                <RotateCw aria-hidden className="size-3.5" />
                {t("changelog.retry")}
              </Button>
            </div>
          )}
          {state.status === "ready" && isEmpty(state.log) && (
            <div className="flex gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs">
              <Info aria-hidden className="mt-px size-3.5 shrink-0 text-muted" />
              <div>
                <p className="font-medium">{t("changelog.none")}</p>
                {state.log.note && <p className="mt-0.5 text-muted">{state.log.note}</p>}
              </div>
            </div>
          )}
          {state.status === "ready" && !isEmpty(state.log) && (
            <>
              {state.log.sections.length > 0 && (
                <Releases sections={state.log.sections} label={state.log.sectionsLabel} onOpen={onOpen} />
              )}
              {state.log.entries.length > 0 && <Commits log={state.log} onOpen={onOpen} />}
              {state.log.note && (
                <p className="mb-2 flex gap-1.5 text-xs text-muted">
                  <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {state.log.note}
                </p>
              )}
              {state.log.installed && (
                <p className="mb-2 text-xs text-muted">
                  {tx("changelog.installed", {
                    sha: state.log.installed.url ? (
                      <Link url={state.log.installed.url} onOpen={onOpen} className="font-mono text-info">
                        {state.log.installed.sha.slice(0, 7)}
                      </Link>
                    ) : (
                      <span className="font-mono">{state.log.installed.sha.slice(0, 7)}</span>
                    ),
                  })}
                  {state.log.installed.message && <span className="text-fg"> · {state.log.installed.message}</span>}
                </p>
              )}
              {state.log.moreUrl && (
                <Link url={state.log.moreUrl} onOpen={onOpen} className="inline-flex items-center gap-1 text-xs text-info">
                  <ExternalLink aria-hidden className="size-3.5" />
                  {state.log.moreUrl.includes("github.com") ? t("changelog.github") : t("changelog.full")}
                </Link>
              )}
            </>
          )}
          {linkError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {linkError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
