import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, Download, FilterX, Power, PowerOff, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t, useT } from "../i18n";
import { cx } from "../lib/cx";
import { canToggle, canUninstall, issueText, kindLabel, relativeTime, sourceLabel } from "../lib/format";
import { loadsEverywhere, shortCount } from "../lib/insights";
import type { SortKey } from "../lib/prefs";
import { isActive, updatable, useStore } from "../store";
import type { Item } from "../types";
import { ContextMenu, type MenuTarget } from "./ContextMenu";
import { Button, card, Checkbox, KindIcon, StatusBadge, Switch } from "./ui";

type Col = "source" | "version" | "cost" | "uses" | "updated";

/** Optional columns, most important first; as the list narrows they drop from the end. */
const optional: [Col, number][] = [
  ["version", 172],
  ["source", 136],
  ["cost", 72],
  ["uses", 64],
  ["updated", 92],
];
const width = Object.fromEntries(optional) as Record<Col, number>;
const GAP = 12;
const ROW_HEIGHT = 52;
// Checkbox, name at its minimum, status and actions, plus the row's side padding.
const BASE = 40 + 190 + 152 + 76 + 3 * GAP + 32;

function useColumns(ref: React.RefObject<HTMLElement | null>): Set<Col> {
  const [cols, setCols] = useState<Set<Col>>(() => new Set(optional.map(([c]) => c)));
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      let used = BASE;
      const next: Col[] = [];
      for (const [c, w] of optional) {
        if (used + w + GAP > e.contentRect.width) break;
        used += w + GAP;
        next.push(c);
      }
      setCols((prev) => (prev.size === next.length && next.every((c) => prev.has(c)) ? prev : new Set(next)));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

function template(cols: Set<Col>) {
  const px = (list: Col[]) => list.filter((c) => cols.has(c)).map((c) => `${width[c]}px`);
  return ["40px", "minmax(190px,1fr)", ...px(["source", "version"]), "152px", ...px(["cost", "uses", "updated"]), "76px"].join(" ");
}

function costTitle(item: Item) {
  if (item.enabled === false) return t("list.costOff");
  if (!loadsEverywhere(item)) return t("list.costProject");
  return t("list.costEvery");
}

function SortHeader({ label, k, className }: { label: string; k: SortKey; className?: string }) {
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const on = sort.key === k;
  const Icon = on ? (sort.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <div role="columnheader" aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"} className={className}>
      <button
        type="button"
        onClick={() => setSort(k)}
        className={cx(
          "-mx-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs font-semibold tracking-wide uppercase transition-colors hover:text-fg",
          on ? "text-fg" : "text-muted",
        )}
      >
        {label}
        <Icon aria-hidden className={cx("size-3.5", !on && "opacity-50")} />
      </button>
    </div>
  );
}

function VersionCell({ item }: { item: Item }) {
  const t = useT();
  const update = item.status === "updateAvailable" && item.latest && item.latest !== item.version;
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
      <span className="truncate" title={item.version ?? undefined}>
        {item.version ?? "—"}
      </span>
      {update && (
        <>
          <span aria-label={t("list.versionTo")} className="text-muted">
            →
          </span>
          <span className="truncate font-medium text-warn" title={item.latest ?? undefined}>
            {item.latest}
          </span>
        </>
      )}
    </div>
  );
}

/** The Enabled switch and an Update button, so the common actions don't need the details panel. */
function RowActions({ item, busy }: { item: Item; busy: boolean }) {
  const t = useT();
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  return (
    <div className="flex items-center justify-end gap-2">
      {updatable([item]).length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("list.update", { name: item.name })}
          title={t("list.update", { name: item.name })}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            confirm({ type: "update", items: [item] });
          }}
          className="inline-flex size-8 items-center justify-center rounded-lg bg-warn/12 text-warn transition-colors duration-150 hover:enabled:bg-warn/22 disabled:opacity-50"
        >
          <Download aria-hidden className="size-4" />
        </button>
      )}
      {canToggle(item) && (
        <Switch
          tabIndex={-1}
          label={t("list.enabled", { name: item.name })}
          checked={item.enabled !== false}
          disabled={busy}
          onChange={() => void run([{ itemId: item.id, action: item.enabled === false ? "enable" : "disable" }])}
        />
      )}
    </div>
  );
}

function BulkBar({ items }: { items: Item[] }) {
  const t = useT();
  const setSelected = useStore((s) => s.setSelected);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const toUpdate = updatable(items);
  const toggleable = items.filter(canToggle);
  const removable = items.filter(canUninstall);
  return (
    <div
      role="toolbar"
      aria-label={t("list.bulkActions")}
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-4"
    >
      <span className="mr-2 text-[13px] font-medium" aria-live="polite">
        {t("list.selected", { count: items.length })}
      </span>
      <Button
        size="sm"
        variant="primary"
        disabled={!toUpdate.length}
        onClick={() => confirm({ type: "update", items: toUpdate })}
      >
        <Download aria-hidden className="size-3.5" />
        {toUpdate.length ? t("list.updateCount", { count: toUpdate.length }) : t("list.updateNone")}
      </Button>
      <Button
        size="sm"
        disabled={!toggleable.some((i) => i.enabled === false)}
        onClick={() =>
          void run(toggleable.filter((i) => i.enabled === false).map((i) => ({ itemId: i.id, action: "enable" as const })))
        }
      >
        <Power aria-hidden className="size-3.5" />
        {t("list.enable")}
      </Button>
      <Button
        size="sm"
        disabled={!toggleable.some((i) => i.enabled === true)}
        onClick={() =>
          void run(toggleable.filter((i) => i.enabled === true).map((i) => ({ itemId: i.id, action: "disable" as const })))
        }
      >
        <PowerOff aria-hidden className="size-3.5" />
        {t("list.disable")}
      </Button>
      <Button size="sm" variant="danger" disabled={!removable.length} onClick={() => confirm({ type: "uninstall", items: removable })}>
        <Trash2 aria-hidden className="size-3.5" />
        {t("list.uninstall")}
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>
        <X aria-hidden className="size-3.5" />
        {t("list.clearSelection")}
      </Button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden className="divide-y divide-border">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex h-[52px] items-center gap-4 px-4">
          <div className="size-4 rounded bg-surface-2" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
            <div className="h-2.5 w-72 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-5 w-24 animate-pulse rounded-full bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

export function ItemList({ rows }: { rows: Item[] }) {
  const t = useT();
  const busy = useStore((s) => s.busy);
  const total = useStore((s) => s.items.length);
  const selected = useStore((s) => s.selected);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setSelected = useStore((s) => s.setSelected);
  const clearFilters = useStore((s) => s.clearFilters);
  const closeDetail = useStore((s) => s.closeDetail);
  const jobs = useStore((s) => s.jobs);
  const busyIds = useMemo(
    () => new Set(Object.values(jobs).filter(isActive).map((j) => j.itemId)),
    [jobs],
  );
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useColumns(wrap);
  const usage = useStore((s) => s.usage);
  const grid = template(cols);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const activeIndex = rows.findIndex((r) => r.id === activeId);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const openMenu = (item: Item, x: number, y: number) => {
    setActive(item.id, false);
    setMenu({ x, y, items: selected.has(item.id) ? selectedRows : [item] });
  };

  const move = (index: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, index));
    if (!rows[i]) return;
    setActive(rows[i].id, false);
    virtualizer.scrollToIndex(i, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on a control inside the grid (sort headers, checkboxes) belong to that control.
    if (e.target !== e.currentTarget || !rows.length) return;
    const cur = activeIndex < 0 ? -1 : activeIndex;
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / ROW_HEIGHT) - 1);
    const handled = () => e.preventDefault();
    switch (e.key) {
      case "ArrowDown":
        handled();
        move(cur + 1);
        break;
      case "ArrowUp":
        handled();
        move(cur < 0 ? 0 : cur - 1);
        break;
      case "PageDown":
        handled();
        move(cur + page);
        break;
      case "PageUp":
        handled();
        move(cur - page);
        break;
      case "Home":
        handled();
        move(0);
        break;
      case "End":
        handled();
        move(rows.length - 1);
        break;
      case " ":
        handled();
        if (cur >= 0) toggleSelected(rows[cur].id);
        break;
      case "Enter":
        handled();
        if (cur >= 0) setActive(rows[cur].id, true);
        break;
      case "Escape":
        if (selected.size) setSelected([]);
        else closeDetail();
        break;
      case "a":
        if (e.ctrlKey || e.metaKey) {
          handled();
          setSelected(rows.map((r) => r.id));
        }
        break;
      case "F10":
      case "ContextMenu":
        if (e.key === "F10" && !e.shiftKey) break;
        handled();
        if (cur >= 0) {
          const r = document.getElementById(`row-${rows[cur].id}`)?.getBoundingClientRect();
          if (r) openMenu(rows[cur], r.left + 48, r.bottom - 8);
        }
        break;
    }
  };

  return (
    <section ref={wrap} aria-label={t("list.installed")} className={cx("flex min-w-0 flex-1 flex-col overflow-hidden", card)}>
      {selectedRows.length > 0 && <BulkBar items={selectedRows} />}

      <div
        role="grid"
        aria-label={t("list.grid")}
        aria-rowcount={rows.length + 1}
        aria-multiselectable="true"
        aria-activedescendant={activeIndex >= 0 ? `row-${rows[activeIndex].id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-offset-[-2px]"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="grid h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4"
          style={{ gridTemplateColumns: grid }}
        >
          <div role="columnheader" className="flex items-center">
            <Checkbox
              label={allSelected ? t("list.deselectAll") : t("list.selectAll")}
              checked={allSelected}
              indeterminate={selectedRows.length > 0 && !allSelected}
              onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}
            />
          </div>
          <SortHeader label={t("list.colName")} k="name" />
          {cols.has("source") && <SortHeader label={t("list.colSource")} k="source" />}
          {cols.has("version") && <SortHeader label={t("list.colVersion")} k="version" />}
          <SortHeader label={t("list.colStatus")} k="status" />
          {cols.has("cost") && <SortHeader label={t("list.colCost")} k="cost" />}
          {cols.has("uses") && <SortHeader label={t("list.colUses")} k="uses" />}
          {cols.has("updated") && <SortHeader label={t("list.colUpdated")} k="updated" />}
          <div role="columnheader" className="text-right text-xs font-semibold tracking-wide text-muted uppercase">
            <span className="sr-only">{t("list.colActions")}</span>
          </div>
        </div>

        <div ref={scroller} role="rowgroup" className="relative min-h-0 flex-1 overflow-y-auto">
          {busy === "scanning" && total === 0 ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FilterX aria-hidden className="size-8 text-muted" />
              <p className="font-medium">{total ? t("list.noMatch") : t("list.empty")}</p>
              <p className="max-w-sm text-[13px] text-muted">
                {total ? t("list.noMatchHint") : t("list.emptyHint")}
              </p>
              {total > 0 && (
                <Button size="sm" onClick={clearFilters}>
                  {t("list.clearFilters")}
                </Button>
              )}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((v) => {
                const item = rows[v.index];
                const isSelected = selected.has(item.id);
                const isCurrent = item.id === activeId;
                return (
                  <div
                    key={item.id}
                    id={`row-${item.id}`}
                    role="row"
                    aria-rowindex={v.index + 2}
                    aria-selected={isSelected}
                    onClick={() => setActive(item.id, true)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(item, e.clientX, e.clientY);
                    }}
                    className={cx(
                      "absolute inset-x-0 grid cursor-pointer items-center gap-3 border-b border-border px-4 transition-colors duration-100",
                      isCurrent ? "bg-surface-2 shadow-[inset_3px_0_0_var(--accent)]" : isSelected ? "bg-accent/6" : "hover:bg-surface-hover",
                    )}
                    style={{ height: ROW_HEIGHT, transform: `translateY(${v.start}px)`, gridTemplateColumns: grid }}
                  >
                    <div role="gridcell" className="flex items-center">
                      <Checkbox label={t("list.select", { name: item.name })} checked={isSelected} onChange={() => toggleSelected(item.id)} />
                    </div>
                    <div role="gridcell" className="min-w-0">
                      <div className="flex items-center gap-2">
                        <KindIcon kind={item.kind} className="size-4" />
                        <span className="truncate font-medium">{item.name}</span>
                        {item.enabled === false && (
                          <span className="rounded border border-border-strong px-1.5 text-[11px] text-muted">{t("list.disabled")}</span>
                        )}
                        {item.isMod && (
                          <span
                            title={t("list.modTitle")}
                            className="rounded border border-info/30 bg-info/10 px-1.5 text-[11px] font-medium text-info"
                          >
                            Mod
                          </span>
                        )}
                        {item.issues.length > 0 && (
                          <span
                            title={item.issues.map(issueText).join("\n")}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-danger/35 bg-danger/10 px-1.5 text-[11px] font-medium text-danger"
                          >
                            <CircleAlert aria-hidden className="size-3" />
                            {t("list.issues", { count: item.issues.length })}
                          </span>
                        )}
                        <span className="sr-only">{kindLabel[item.kind]}</span>
                      </div>
                      <p className="truncate pl-6 text-xs text-muted">{item.description ?? t("list.noDescription")}</p>
                    </div>
                    {cols.has("source") && (
                      <div role="gridcell" className="min-w-0 text-[13px]">
                        <div className="truncate">{sourceLabel[item.source]}</div>
                        <div className="truncate font-mono text-[11px] text-muted" title={item.origin ?? undefined}>
                          {item.origin ?? ""}
                        </div>
                      </div>
                    )}
                    {cols.has("version") && (
                      <div role="gridcell" className="min-w-0">
                        <VersionCell item={item} />
                      </div>
                    )}
                    <div role="gridcell" className="min-w-0">
                      <StatusBadge status={item.status} checking={busy === "checking"} title={item.statusDetail} />
                    </div>
                    {cols.has("cost") && (
                      <div
                        role="gridcell"
                        title={costTitle(item)}
                        className={cx("font-mono text-xs tabular-nums", !loadsEverywhere(item) && "text-muted")}
                      >
                        {item.cost?.total ? `≈${shortCount(item.cost.total)}` : "—"}
                      </div>
                    )}
                    {cols.has("uses") && (
                      <div role="gridcell" title={t("list.usesTitle")} className="font-mono text-xs tabular-nums">
                        {usage ? (usage[item.id]?.uses ?? 0) : <span className="text-muted" aria-label={t("list.counting")}>…</span>}
                      </div>
                    )}
                    {cols.has("updated") && (
                      <div role="gridcell" className="text-xs text-muted" title={item.updatedAt ?? item.installedAt ?? undefined}>
                        {relativeTime(item.updatedAt ?? item.installedAt)}
                      </div>
                    )}
                    <div role="gridcell">
                      <RowActions item={item} busy={busyIds.has(item.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-border bg-surface px-4 text-xs text-muted">
        <span>{t("list.showing", { shown: rows.length, total })}</span>
        <span className="hidden md:inline">{t("list.keys")}</span>
      </footer>
      {menu && <ContextMenu target={menu} onClose={closeMenu} />}
    </section>
  );
}
