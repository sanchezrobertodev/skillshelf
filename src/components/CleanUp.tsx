import { Building2, FolderSymlink, Hammer, Lock, LoaderCircle, PowerOff, RotateCcw, Trash2, CircleMinus, BrushCleaning } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { t, tx, useT } from "../i18n";
import { cx } from "../lib/cx";
import { relativeTime, statusLabel } from "../lib/format";
import { hasHooks, isUnused, shortCount } from "../lib/insights";
import { isActive, useStore } from "../store";
import type { Item } from "../types";
import { Button, card, KindIcon, Switch } from "./ui";

const byCost = (a: Item, b: Item) => (b.cost?.total ?? 0) - (a.cost?.total ?? 0);
const tokens = (i: Item) => (i.cost?.total ? t("cleanup.tokens", { tokens: shortCount(i.cost.total) }) : null);

function Section({
  title,
  icon: Icon,
  count,
  description,
  actions,
  children,
}: {
  title: string;
  icon: typeof Lock;
  count?: number;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(card, "shrink-0 overflow-hidden")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="flex items-center gap-2 text-[13px] font-semibold">
            <Icon aria-hidden className="size-4 text-muted" />
            {title}
            {count !== undefined && <span className="font-mono text-xs font-normal text-muted">{count}</span>}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-[13px] text-muted">{children}</p>;
}

/** One item: its name opens it in the Library; `lead` and `children` hold the controls. */
function Row({ item, detail, lead, children }: { item: Item; detail: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  const reveal = useStore((s) => s.reveal);
  return (
    <li className="flex min-h-12 items-center gap-3 px-4 py-2">
      {lead}
      <KindIcon kind={item.kind} className="size-4" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => reveal(item.id)} className="max-w-full truncate rounded text-left text-[13px] font-medium hover:underline">
          {item.name}
        </button>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      {children}
    </li>
  );
}

function UnusedPlugins({ items }: { items: Item[] }) {
  const t = useT();
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const usage = useStore((s) => s.usage);
  const progress = useStore((s) => s.usageProgress);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const unused = usage ? items.filter((i) => isUnused(i, usage)).sort(byCost) : null;
  const chosen = unused?.filter((i) => picked.has(i.id)) ?? [];
  const total = unused?.reduce((n, i) => n + (i.cost?.total ?? 0), 0) ?? 0;
  const all = !!unused?.length && chosen.length === unused.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Section
      title={t("cleanup.unused")}
      icon={BrushCleaning}
      count={unused?.length}
      description={
        unused?.length
          ? t("cleanup.unusedHelp", { tokens: shortCount(total) })
          : t("cleanup.unusedNone")
      }
      actions={
        unused?.length ? (
          <>
            <Button
              size="sm"
              disabled={!chosen.length}
              onClick={() => {
                void run(chosen.map((i) => ({ itemId: i.id, action: "disable" as const })));
                setPicked(new Set());
              }}
            >
              <PowerOff aria-hidden className="size-3.5" />
              {chosen.length ? t("cleanup.turnOffCount", { count: chosen.length }) : t("cleanup.turnOff")}
            </Button>
            <Button size="sm" variant="danger" disabled={!chosen.length} onClick={() => confirm({ type: "uninstall", items: chosen })}>
              <Trash2 aria-hidden className="size-3.5" />
              {chosen.length ? t("cleanup.uninstallCount", { count: chosen.length }) : t("cleanup.uninstall")}
            </Button>
          </>
        ) : undefined
      }
    >
      {!unused ? (
        <p className="flex items-center gap-1.5 px-4 py-4 text-[13px] text-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {progress?.total ? t("cleanup.countingProgress", { read: progress.read, total: progress.total }) : t("cleanup.counting")}
        </p>
      ) : unused.length === 0 ? (
        <Empty>{t("cleanup.allUsed")}</Empty>
      ) : (
        <>
          <label className="flex h-9 items-center gap-3 border-b border-border px-4 text-xs text-muted">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setPicked(all ? new Set() : new Set(unused.map((i) => i.id)))}
              className="size-4 cursor-pointer accent-[var(--accent)]"
            />
            {t("cleanup.selectAll")}
          </label>
          <ul className="divide-y divide-border">
            {unused.map((i) => (
              <Row
                key={i.id}
                item={i}
                detail={[tokens(i), usage?.[i.id]?.lastUsed ? t("cleanup.lastUsed", { time: relativeTime(usage[i.id].lastUsed) }) : t("cleanup.noUses")]
                  .filter(Boolean)
                  .join(" · ")}
                lead={
                  <input
                    type="checkbox"
                    aria-label={t("cleanup.select", { name: i.name })}
                    checked={picked.has(i.id)}
                    onChange={() => toggle(i.id)}
                    className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                  />
                }
              />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export function CleanUp() {
  const t = useT();
  const items = useStore((s) => s.items);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const jobs = useStore((s) => s.jobs);
  const [error, setError] = useState<string | null>(null);
  const busy = new Set(Object.values(jobs).filter(isActive).map((j) => j.itemId));

  const hooks = items.filter((i) => i.kind === "plugin" && hasHooks(i) && i.source !== "synced").sort(byCost);
  const managed = items.filter((i) => i.source === "synced").sort(byCost);
  const moved = items.filter((i) => i.status === "moved");
  const removed = items.filter((i) => i.status === "removed");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
      {error && (
        <p role="alert" className="shrink-0 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <UnusedPlugins items={items} />

      <Section
        title={t("cleanup.hooks")}
        icon={Hammer}
        count={hooks.length}
        description={t("cleanup.hooksHelp")}
      >
        {hooks.length === 0 ? (
          <Empty>{t("cleanup.noHooks")}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {hooks.map((i) => (
              <Row
                key={i.id}
                item={i}
                detail={[tokens(i), t("cleanup.hookEvents", { count: i.children.filter((c) => c.kind === "hook").length }), i.isMod && t("cleanup.mod")].filter(Boolean).join(" · ")}
              >
                {i.enabled !== null && (
                  <Switch
                    label={t("cleanup.enabled", { name: i.name })}
                    checked={i.enabled}
                    disabled={busy.has(i.id)}
                    onChange={() => void run([{ itemId: i.id, action: i.enabled ? "disable" : "enable" }])}
                  />
                )}
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("cleanup.moved")}
        icon={FolderSymlink}
        count={moved.length}
        description={t("cleanup.movedHelp")}
        actions={
          moved.length > 1 ? (
            <Button size="sm" onClick={() => void run(moved.filter((i) => !busy.has(i.id)).map((i) => ({ itemId: i.id, action: "reinstall" as const })))}>
              <RotateCcw aria-hidden className="size-3.5" />
              {t("cleanup.reinstallAll")}
            </Button>
          ) : undefined
        }
      >
        {moved.length === 0 ? (
          <Empty>{t("cleanup.noMoved")}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {moved.map((i) => (
              <Row
                key={i.id}
                item={i}
                detail={i.upstream ? t("cleanup.nowAt", { location: i.upstream.folder ? `${i.upstream.repo}/${i.upstream.folder}` : i.upstream.repo }) : i.statusDetail}
              >
                <Button size="sm" disabled={busy.has(i.id)} onClick={() => void run([{ itemId: i.id, action: "reinstall" }])}>
                  <RotateCcw aria-hidden className="size-3.5" />
                  {t("cleanup.reinstall")}
                </Button>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("cleanup.removed")}
        icon={CircleMinus}
        count={removed.length}
        description={t("cleanup.removedHelp")}
        actions={
          removed.length > 1 ? (
            <Button size="sm" variant="danger" onClick={() => confirm({ type: "uninstall", items: removed })}>
              <Trash2 aria-hidden className="size-3.5" />
              {t("cleanup.uninstallAll")}
            </Button>
          ) : undefined
        }
      >
        {removed.length === 0 ? (
          <Empty>{t("cleanup.noRemoved")}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {removed.map((i) => {
              const c = i.upstream?.commit;
              return (
                <Row
                  key={i.id}
                  item={i}
                  detail={
                    c ? (
                      <>
                        {tx("cleanup.removedIn", {
                          commit: c.url ? (
                            <button
                              type="button"
                              onClick={() => api.openChangelogLink(i.id, c.url!).catch((e) => setError(errorText(e)))}
                              className="rounded font-mono text-info hover:underline"
                            >
                              {c.sha.slice(0, 7)}
                            </button>
                          ) : (
                            <span className="font-mono">{c.sha.slice(0, 7)}</span>
                          ),
                        })}
                        {c.date && ` ${relativeTime(c.date)}`}
                        {c.message && ` · ${c.message}`}
                      </>
                    ) : (
                      (i.statusDetail ?? statusLabel.removed)
                    )
                  }
                >
                  <Button size="sm" variant="danger" disabled={busy.has(i.id)} onClick={() => confirm({ type: "uninstall", items: [i] })}>
                    <Trash2 aria-hidden className="size-3.5" />
                    {t("cleanup.uninstall")}
                  </Button>
                </Row>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title={t("cleanup.managed")}
        icon={Building2}
        count={managed.length}
        description={t("cleanup.managedHelp")}
      >
        {managed.length === 0 ? (
          <Empty>{t("cleanup.noManaged")}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {managed.map((i) => (
              <Row key={i.id} item={i} detail={[tokens(i), i.enabled === false ? t("cleanup.off") : t("cleanup.on")].filter(Boolean).join(" · ")}>
                <Lock role="img" aria-label={t("cleanup.locked")} className="size-4 shrink-0 text-muted" />
              </Row>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
