import clsx from "clsx";
import { ChevronRight, ExternalLink, GitCommitHorizontal, History, Info, LoaderCircle, RotateCw } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { isEmpty, useChangelog } from "../lib/changelog";
import { fullDate, relativeTime } from "../lib/format";
import type { Changelog, ChangelogSection, Item } from "../types";
import { Button } from "./ui";

const COMMITS_SHOWN = 8;
const SECTIONS_SHOWN = 3;

type OpenLink = (url: string) => void;

function Link({ url, onOpen, className, children }: { url: string; onOpen: OpenLink; className?: string; children: ReactNode }) {
  return (
    <a
      href={url}
      title={url}
      onClick={(e) => {
        e.preventDefault();
        onOpen(url);
      }}
      className={clsx("cursor-pointer underline-offset-2 transition-colors duration-150 hover:underline", className)}
    >
      {children}
    </a>
  );
}

/** `code`, **bold** and [links](https://…) inside one line of a release note. */
function Inline({ text, onOpen }: { text: string; onOpen: OpenLink }) {
  const parts = text.split(/(\[[^\]]+\]\(https:\/\/[^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(p);
        if (link)
          return (
            <Link key={i} url={link[2]} onOpen={onOpen} className="text-info">
              {link[1]}
            </Link>
          );
        if (/^`[^`]+`$/.test(p))
          return (
            <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[11px]">
              {p.slice(1, -1)}
            </code>
          );
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Just enough markdown for changelogs: headings, bullet lists and paragraphs. */
function Notes({ body, onOpen }: { body: string; onOpen: OpenLink }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const list = bullets;
    bullets = [];
    blocks.push(
      <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-4">
        {list.map((b, i) => (
          <li key={i}>
            <Inline text={b} onOpen={onOpen} />
          </li>
        ))}
      </ul>,
    );
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line || line.startsWith("```")) continue;
    blocks.push(
      heading ? (
        <p key={blocks.length} className="mt-2 text-[11px] font-semibold tracking-wider text-muted uppercase first:mt-0">
          {heading[1]}
        </p>
      ) : (
        <p key={blocks.length} className="my-1">
          <Inline text={line} onOpen={onOpen} />
        </p>
      ),
    );
  }
  flush();
  return <div className="text-xs leading-relaxed break-words">{blocks}</div>;
}

function Releases({ sections, label, onOpen }: { sections: ChangelogSection[]; label: string | null; onOpen: OpenLink }) {
  const [all, setAll] = useState(false);
  const shown = all ? sections : sections.slice(0, SECTIONS_SHOWN);
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs text-muted">
        Release notes{label && <> from <span className="font-mono">{label}</span></>}
      </p>
      <div className="divide-y divide-border rounded-md border border-border">
        {shown.map((s, i) => (
          <details key={`${s.version}-${i}`} open={i === 0} className="group">
            <summary className="flex list-none items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors duration-150 hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted transition-transform duration-150 group-open:rotate-90" />
              <span className="min-w-0 truncate font-mono text-xs">{s.title}</span>
            </summary>
            <div className="px-3 pt-0.5 pb-2.5">
              {s.body ? <Notes body={s.body} onOpen={onOpen} /> : <p className="text-xs text-muted">No notes for this release.</p>}
            </div>
          </details>
        ))}
      </div>
      {sections.length > SECTIONS_SHOWN && (
        <Button size="sm" variant="ghost" className="mt-1 -ml-2.5 text-muted" onClick={() => setAll(!all)}>
          {all ? "Show fewer releases" : `Show ${sections.length - SECTIONS_SHOWN} more releases`}
        </Button>
      )}
    </div>
  );
}

function Commits({ log, onOpen }: { log: Changelog; onOpen: OpenLink }) {
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
                  {e.message || "(no message)"}
                </Link>
              ) : (
                <p className="line-clamp-2 text-xs">{e.message || "(no message)"}</p>
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
          {all ? "Show fewer commits" : `Show all ${log.entries.length} commits`}
        </Button>
      )}
      {hidden > 0 && <p className="mt-1 text-xs text-muted">{hidden} older commits aren't listed here.</p>}
    </div>
  );
}

export function ChangelogPanel({ item }: { item: Item }) {
  const [open, setOpen] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { state, retry } = useChangelog(item, open);
  const onOpen: OpenLink = (url) => {
    setLinkError(null);
    api.openChangelogLink(item.id, url).catch((e) => setLinkError(errorText(e)));
  };

  return (
    <section className="mb-6" aria-label="What changed">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1 mb-1.5 flex items-center gap-1.5 rounded px-1 text-[11px] font-semibold tracking-wider text-muted uppercase transition-colors duration-150 hover:text-fg"
      >
        <ChevronRight aria-hidden className={clsx("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        <History aria-hidden className="size-3.5" />
        What changed
      </button>

      {open && (
        <div aria-live="polite">
          {(state.status === "loading" || state.status === "idle") && (
            <p className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-xs text-muted">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              Looking up what changed…
            </p>
          )}
          {state.status === "error" && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <p>Couldn't load the changes. {state.error}</p>
              <Button size="sm" className="mt-2" onClick={retry}>
                <RotateCw aria-hidden className="size-3.5" />
                Try again
              </Button>
            </div>
          )}
          {state.status === "ready" && isEmpty(state.log) && (
            <div className="flex gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs">
              <Info aria-hidden className="mt-px size-3.5 shrink-0 text-muted" />
              <div>
                <p className="font-medium">No changelog available</p>
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
              {state.log.moreUrl && (
                <Link url={state.log.moreUrl} onOpen={onOpen} className="inline-flex items-center gap-1 text-xs text-info">
                  <ExternalLink aria-hidden className="size-3.5" />
                  {state.log.moreUrl.includes("github.com") ? "View history on GitHub" : "Open the full changelog"}
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
