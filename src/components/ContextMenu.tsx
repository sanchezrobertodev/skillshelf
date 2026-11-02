import { Download, ExternalLink, FolderOpen, Power, PowerOff, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorText } from "../api";
import { type TKey, useT } from "../i18n";
import { cx } from "../lib/cx";
import { canReinstall, canToggle, canUninstall } from "../lib/format";
import { updatable, useStore } from "../store";
import type { Item } from "../types";

export interface MenuTarget {
  x: number;
  y: number;
  /** The right-clicked row, or the whole selection when that row is in it. */
  items: Item[];
}

interface Entry {
  label: string;
  icon: typeof Download;
  danger?: boolean;
  act: () => void;
}

/** Row actions at the pointer (or under the active row for Shift+F10 / the Menu key). */
export function ContextMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const t = useT();
  const run = useStore((s) => s.run);
  const confirm = useStore((s) => s.confirm);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const { items } = target;
  const one = items.length === 1 ? items[0] : null;
  const label = (key: TKey, many: TKey, n: number) => (items.length > 1 ? t(many, { count: n }) : t(key));
  const toUpdate = updatable(items);
  const off = items.filter((i) => canToggle(i) && i.enabled === false);
  const on = items.filter((i) => canToggle(i) && i.enabled === true);
  const removable = items.filter(canUninstall);
  const movable = items.filter(canReinstall);
  const attempt = (fn: () => Promise<void>) => fn().catch((e) => useStore.setState({ error: errorText(e) }));

  const entries: Entry[] = [
    toUpdate.length && { label: label("menu.update", "menu.updateMany", toUpdate.length), icon: Download, act: () => confirm({ type: "update", items: toUpdate }) },
    movable.length && { label: label("menu.reinstall", "menu.reinstallMany", movable.length), icon: RotateCcw, act: () => void run(movable.map((i) => ({ itemId: i.id, action: "reinstall" as const }))) },
    off.length && { label: label("menu.turnOn", "menu.turnOnMany", off.length), icon: Power, act: () => void run(off.map((i) => ({ itemId: i.id, action: "enable" as const }))) },
    on.length && { label: label("menu.turnOff", "menu.turnOffMany", on.length), icon: PowerOff, act: () => void run(on.map((i) => ({ itemId: i.id, action: "disable" as const }))) },
    one?.path && { label: t("menu.openFolder"), icon: FolderOpen, act: () => attempt(() => api.openFolder(one.id)) },
    one?.repoUrl && { label: t("menu.openRepo"), icon: ExternalLink, act: () => attempt(() => api.openRepo(one.id)) },
    removable.length && { label: label("menu.uninstall", "menu.uninstallMany", removable.length), icon: Trash2, danger: true, act: () => confirm({ type: "uninstall", items: removable }) },
  ].filter((e): e is Entry => !!e);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = menu.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(target.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - r.height - 4)),
    });
  }, [target]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const blur = () => onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
      prev?.focus();
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Portalled to <body> so viewport coordinates hold: the list's frosted .card (backdrop-filter) would contain and clip it.
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={one ? t("menu.itemActions", { name: one.name }) : t("menu.itemsActions", { count: items.length })}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={pos}
      className="fixed z-40 min-w-48 rounded-lg border border-card-border bg-surface p-1 shadow-2xl"
    >
      {entries.length === 0 && <p className="px-2.5 py-1.5 text-[13px] text-muted">{t("menu.none")}</p>}
      {entries.map((e) => (
        <button
          key={e.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose();
            e.act();
          }}
          className={cx(
            "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors duration-100 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
            e.danger && "text-danger",
          )}
        >
          <e.icon aria-hidden className="size-4 shrink-0" />
          {e.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
