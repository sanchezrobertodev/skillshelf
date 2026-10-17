import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FilterX, Power, PowerOff, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { canToggle, canUninstall, canUpdate, relativeTime, sourceLabel } from "../lib/format";
import type { SortKey } from "../lib/prefs";
import { useStore } from "../store";
import type { Item } from "../types";
import { Button, Checkbox, KindIcon, StatusBadge } from "./ui";

type Layout = "wide" | "medium" | "narrow";

const templates: Record<Layout, string> = {
  wide: "40px minmax(220px,1fr) 136px 172px 152px 92px",
  medium: "40px minmax(200px,1fr) 172px 152px",
  narrow: "40px minmax(160px,1fr) 152px",
};

const ROW_HEIGHT = 52;

function useLayout(ref: React.RefObject<HTMLElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>("wide");
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setLayout(w >= 860 ? "wide" : w >= 640 ? "medium" : "narrow");
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
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
        className={clsx(
          "-mx-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs font-semibold tracking-wide uppercase transition-colors hover:text-fg",
          on ? "text-fg" : "text-muted",
        )}
      >
        {label}
        <Icon aria-hidden className={clsx("size-3.5", !on && "opacity-50")} />
      </button>
    </div>
  );
}

function VersionCell({ item }: { item: Item }) {
  const update = item.status === "updateAvailable" && item.latest && item.latest !== item.version;
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
      <span className="truncate" title={item.version ?? undefined}>
        {item.version ?? "—"}
      </span>
      {update && (
        <>
          <span aria-label="to" className="text-muted">
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

function BulkBar({ items }: { items: Item[] }) {
  const setSelected = useStore((s) => s.setSelected);
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const updatable = items.filter((i) => i.status === "updateAvailable" && canUpdate(i));
  const toggleable = items.filter(canToggle);
  const removable = items.filter(canUninstall);
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-4"
    >
      <span className="mr-2 text-[13px] font-medium" aria-live="polite">
        {items.length} selected
      </span>
      <Button
        size="sm"
        variant="primary"
        disabled={!updatable.length}
        onClick={() => confirm({ type: "update", items: updatable })}
      >
        <Download aria-hidden className="size-3.5" />
        Update{updatable.length ? ` ${updatable.length}` : ""}
      </Button>
      <Button
        size="sm"
        disabled={!toggleable.some((i) => i.enabled === false)}
        onClick={() =>
          void run(toggleable.filter((i) => i.enabled === false).map((i) => ({ itemId: i.id, action: "enable" as const })))
        }
      >
        <Power aria-hidden className="size-3.5" />
        Enable
      </Button>
      <Button
        size="sm"
        disabled={!toggleable.some((i) => i.enabled === true)}
        onClick={() =>
          void run(toggleable.filter((i) => i.enabled === true).map((i) => ({ itemId: i.id, action: "disable" as const })))
        }
      >
        <PowerOff aria-hidden className="size-3.5" />
        Disable
      </Button>
      <Button size="sm" variant="danger" disabled={!removable.length} onClick={() => confirm({ type: "uninstall", items: removable })}>
        <Trash2 aria-hidden className="size-3.5" />
        Uninstall
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>
        <X aria-hidden className="size-3.5" />
        Clear selection
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
  const busy = useStore((s) => s.busy);
  const total = useStore((s) => s.items.length);
  const selected = useStore((s) => s.selected);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setSelected = useStore((s) => s.setSelected);
  const clearFilters = useStore((s) => s.clearFilters);
  const closeDetail = useStore((s) => s.closeDetail);

  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const layout = useLayout(wrap);
  const template = templates[layout];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const activeIndex = rows.findIndex((r) => r.id === activeId);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const move = (index: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, index));
    if (!rows[i]) return;
    setActive(rows[i].id, false);
    virtualizer.scrollToIndex(i, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
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
    }
  };

  return (
    <section ref={wrap} aria-label="Installed items" className="flex min-w-0 flex-1 flex-col">
      {selectedRows.length > 0 && <BulkBar items={selectedRows} />}

      <div
        role="row"
        className="grid h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4"
        style={{ gridTemplateColumns: template }}
      >
        <div role="columnheader" className="flex items-center">
          <Checkbox
            label={allSelected ? "Deselect all" : "Select all shown"}
            checked={allSelected}
            indeterminate={selectedRows.length > 0 && !allSelected}
            onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}
          />
        </div>
        <SortHeader label="Name" k="name" />
        {layout === "wide" && <SortHeader label="Source" k="source" />}
        {layout !== "narrow" && <SortHeader label="Version" k="version" />}
        <SortHeader label="Status" k="status" />
        {layout === "wide" && <SortHeader label="Updated" k="updated" />}
      </div>

      <div
        ref={scroller}
        role="grid"
        aria-label="Skills and plugins"
        aria-rowcount={rows.length}
        aria-multiselectable="true"
        aria-activedescendant={activeIndex >= 0 ? `row-${rows[activeIndex].id}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-2px]"
      >
        {busy === "scanning" && total === 0 ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <FilterX aria-hidden className="size-8 text-muted" />
            <p className="font-medium">{total ? "Nothing matches these filters" : "No skills or plugins found"}</p>
            <p className="max-w-sm text-[13px] text-muted">
              {total
                ? "Try a different search, or clear the filters to see everything."
                : "Skillshelf looks in ~/.claude for plugins and skills. Install something with claude plugin install or npx skills add, then refresh."}
            </p>
            {total > 0 && (
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((v) => {
              const item = rows[v.index];
              const isSelected = selected.has(item.id);
              const isActive = item.id === activeId;
              return (
                <div
                  key={item.id}
                  id={`row-${item.id}`}
                  role="row"
                  aria-rowindex={v.index + 1}
                  aria-selected={isSelected}
                  onClick={() => setActive(item.id, true)}
                  className={clsx(
                    "absolute inset-x-0 grid cursor-pointer items-center gap-3 border-b border-border px-4 transition-colors duration-100",
                    isActive ? "bg-surface-2 shadow-[inset_3px_0_0_var(--accent)]" : isSelected ? "bg-accent/6" : "hover:bg-surface-hover",
                  )}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${v.start}px)`, gridTemplateColumns: template }}
                >
                  <div role="gridcell" className="flex items-center">
                    <Checkbox label={`Select ${item.name}`} checked={isSelected} onChange={() => toggleSelected(item.id)} />
                  </div>
                  <div role="gridcell" className="min-w-0">
                    <div className="flex items-center gap-2">
                      <KindIcon kind={item.kind} className="size-4" />
                      <span className="truncate font-medium">{item.name}</span>
                      {item.enabled === false && (
                        <span className="rounded border border-border-strong px-1.5 text-[11px] text-muted">Disabled</span>
                      )}
                      <span className="sr-only">{item.kind}</span>
                    </div>
                    <p className="truncate pl-6 text-xs text-muted">{item.description ?? "No description"}</p>
                  </div>
                  {layout === "wide" && (
                    <div role="gridcell" className="min-w-0 text-[13px]">
                      <div className="truncate">{sourceLabel[item.source]}</div>
                      <div className="truncate font-mono text-[11px] text-muted" title={item.origin ?? undefined}>
                        {item.origin ?? ""}
                      </div>
                    </div>
                  )}
                  {layout !== "narrow" && (
                    <div role="gridcell" className="min-w-0">
                      <VersionCell item={item} />
                    </div>
                  )}
                  <div role="gridcell" className="min-w-0">
                    <StatusBadge status={item.status} checking={busy === "checking"} title={item.statusDetail} />
                  </div>
                  {layout === "wide" && (
                    <div role="gridcell" className="text-xs text-muted" title={item.updatedAt ?? item.installedAt ?? undefined}>
                      {relativeTime(item.updatedAt ?? item.installedAt)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-border bg-surface px-4 text-xs text-muted">
        <span>
          Showing {rows.length} of {total}
        </span>
        <span className="hidden md:inline">↑↓ move · Space select · Enter details · Ctrl A select all</span>
      </footer>
    </section>
  );
}
