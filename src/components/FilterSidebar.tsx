import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { countBy, matches, type Facet } from "../lib/filter";
import { kindLabel, sourceHelp, sourceLabel, statusLabel, statusOrder } from "../lib/format";
import type { Filters } from "../lib/prefs";
import { useStore } from "../store";
import type { Kind, Source, Status } from "../types";

interface Option<T extends string> {
  value: T;
  label: string;
  count: number;
  hint?: string;
}

function Group<T extends string>({
  title,
  options,
  selected,
  onToggle,
  limit,
}: {
  title: string;
  options: Option<T>[];
  selected: T[];
  onToggle: (v: T) => void;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const shown = limit && !expanded ? options.slice(0, limit) : options;
  return (
    <fieldset className="mb-5">
      <legend className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</legend>
      <ul>
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <li key={o.value}>
              <label
                title={o.hint}
                className={clsx(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors duration-150 hover:bg-surface-hover",
                  on && "bg-surface-2 font-medium",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(o.value)}
                  className="size-3.5 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className={clsx("font-mono text-xs tabular-nums", o.count ? "text-muted" : "text-muted/60")}>
                  {o.count}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {limit && options.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:text-fg"
          aria-expanded={expanded}
        >
          <ChevronDown aria-hidden className={clsx("size-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Show fewer" : `Show all ${options.length}`}
        </button>
      )}
    </fieldset>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function FilterSidebar() {
  const items = useStore((s) => s.items);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const clearFilters = useStore((s) => s.clearFilters);
  const query = useDeferredValue(useStore((s) => s.query));

  const facets = useMemo(() => {
    const pool = (f: Facet) => items.filter((i) => matches(i, filters, query, f));
    const kinds = countBy(pool("kinds"), (i) => i.kind);
    const statuses = countBy(pool("statuses"), (i) => i.status);
    const sources = countBy(pool("sources"), (i) => i.source);
    const originPool = pool("origins");
    const origins = countBy(originPool, (i) => i.origin);
    const allOrigins = [...new Set(items.map((i) => i.origin).filter((o): o is string => !!o))];
    const enabledPool = pool("enabled");
    return { kinds, statuses, sources, origins, allOrigins, enabledPool };
  }, [items, filters, query]);

  const kindOpts: Option<Kind>[] = (["plugin", "skill"] as Kind[]).map((k) => ({
    value: k,
    label: kindLabel[k] + "s",
    count: facets.kinds.get(k) ?? 0,
  }));
  const presentStatuses = [...new Set(items.map((i) => i.status))].sort((a, b) => statusOrder[a] - statusOrder[b]);
  const statusOpts: Option<Status>[] = presentStatuses.map((s) => ({
    value: s,
    label: statusLabel[s],
    count: facets.statuses.get(s) ?? 0,
  }));
  const presentSources = (["marketplace", "synced", "skillsCli", "local", "project"] as Source[]).filter((s) =>
    items.some((i) => i.source === s),
  );
  const sourceOpts: Option<Source>[] = presentSources.map((s) => ({
    value: s,
    label: sourceLabel[s],
    count: facets.sources.get(s) ?? 0,
    hint: sourceHelp[s],
  }));
  const originOpts: Option<string>[] = facets.allOrigins
    .map((o) => ({ value: o, label: o, count: facets.origins.get(o) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const enabledCount = facets.enabledPool.filter((i) => i.enabled === true).length;
  const disabledCount = facets.enabledPool.filter((i) => i.enabled === false).length;
  const active =
    filters.kinds.length + filters.statuses.length + filters.sources.length + filters.origins.length +
    (filters.enabled !== "all" ? 1 : 0);

  const set = (f: Partial<Filters>) => setFilters(f);

  return (
    <aside aria-label="Filters" className="flex w-[232px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-11 items-center justify-between px-4">
        <h2 className="text-[13px] font-semibold">Filters</h2>
        {active > 0 && (
          <button type="button" onClick={clearFilters} className="rounded px-1.5 py-0.5 text-xs text-accent hover:underline">
            Clear {active}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 pb-4">
        <Group title="Type" options={kindOpts} selected={filters.kinds} onToggle={(v) => set({ kinds: toggle(filters.kinds, v) })} />
        <Group
          title="Status"
          options={statusOpts}
          selected={filters.statuses}
          onToggle={(v) => set({ statuses: toggle(filters.statuses, v) })}
        />
        <Group
          title="Source"
          options={sourceOpts}
          selected={filters.sources}
          onToggle={(v) => set({ sources: toggle(filters.sources, v) })}
        />
        <fieldset className="mb-5">
          <legend className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Plugin state</legend>
          <div role="radiogroup" className="mx-2 grid grid-cols-3 rounded-md border border-border-strong p-0.5 text-xs">
            {(
              [
                ["all", "All", null],
                ["enabled", "On", enabledCount],
                ["disabled", "Off", disabledCount],
              ] as const
            ).map(([v, label, n]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={filters.enabled === v}
                onClick={() => set({ enabled: v })}
                className={clsx(
                  "h-7 rounded transition-colors duration-150",
                  filters.enabled === v ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg",
                )}
              >
                {label}
                {n !== null && <span className="ml-1 font-mono text-[11px] text-muted">{n}</span>}
              </button>
            ))}
          </div>
        </fieldset>
        <Group
          title="Marketplace / repo"
          options={originOpts}
          selected={filters.origins}
          onToggle={(v) => set({ origins: toggle(filters.origins, v) })}
          limit={6}
        />
      </div>
    </aside>
  );
}
