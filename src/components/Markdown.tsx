import { Fragment, type ReactNode } from "react";
import { cx } from "../lib/cx";

export type OpenLink = (url: string) => void;

export function Link({ url, onOpen, className, children }: { url: string; onOpen: OpenLink; className?: string; children: ReactNode }) {
  return (
    <a
      href={url}
      title={url}
      onClick={(e) => {
        e.preventDefault();
        onOpen(url);
      }}
      className={cx("cursor-pointer underline-offset-2 transition-colors duration-150 hover:underline", className)}
    >
      {children}
    </a>
  );
}

/** `code`, **bold** and [links](https://…). Without `onOpen`, links show as their text. */
function Inline({ text, onOpen }: { text: string; onOpen?: OpenLink }) {
  const parts = text.split(/(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
        if (link)
          return onOpen && link[2].startsWith("https://") ? (
            <Link key={i} url={link[2]} onOpen={onOpen} className="text-info">
              {link[1]}
            </Link>
          ) : (
            <Fragment key={i}>{link[1]}</Fragment>
          );
        if (/^`[^`]+`$/.test(p))
          return (
            <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">
              {p.slice(1, -1)}
            </code>
          );
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/**
 * Just enough Markdown for changelogs, release notes and SKILL.md/README previews:
 * headings, bullet lists (with wrapped lines), paragraphs and fenced code blocks.
 * shortcut: tables, images and nested lists show as plain lines; switch to a real parser if previews need them.
 */
export function Markdown({ text, onOpen, className }: { text: string; onOpen?: OpenLink; className?: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (!bullets.length) return;
    const list = bullets;
    bullets = [];
    blocks.push(
      <ul key={blocks.length} className="my-1.5 list-disc space-y-0.5 pl-5">
        {list.map((b, i) => (
          <li key={i}>
            <Inline text={b} onOpen={onOpen} />
          </li>
        ))}
      </ul>,
    );
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(
          <pre key={blocks.length} className="my-2 overflow-x-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[0.9em] leading-snug">
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    if (line && bullets.length && /^\s+/.test(raw)) {
      bullets[bullets.length - 1] += ` ${line}`;
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="mt-3 mb-1 font-semibold first:mt-0">
          <Inline text={heading[1]} onOpen={onOpen} />
        </p>
      ) : (
        <p key={blocks.length} className="my-1.5">
          <Inline text={line} onOpen={onOpen} />
        </p>
      ),
    );
  }
  flush();
  if (code) blocks.push(<pre key={blocks.length} className="my-2 overflow-x-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[0.9em]">{code.join("\n")}</pre>);
  return <div className={cx("leading-relaxed break-words", className)}>{blocks}</div>;
}
