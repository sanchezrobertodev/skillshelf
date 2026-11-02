import { BrushCleaning, LayoutDashboard, LibraryBig, Monitor, Moon, Server, Settings, Sun } from "lucide-react";
import { type TKey, useT } from "../i18n";
import { cx } from "../lib/cx";
import type { Theme } from "../lib/prefs";
import { type Screen, useStore } from "../store";

const screens: { id: Screen; label: TKey; icon: typeof LibraryBig }[] = [
  { id: "overview", label: "rail.overview", icon: LayoutDashboard },
  { id: "library", label: "rail.library", icon: LibraryBig },
  { id: "cleanup", label: "rail.cleanup", icon: BrushCleaning },
  { id: "mcp", label: "rail.mcp", icon: Server },
];

const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const themeIcon = { system: Monitor, light: Sun, dark: Moon };

const itemCls =
  "flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-[11px] font-medium transition-colors duration-150";
const idleCls = "text-muted hover:bg-surface-hover hover:text-fg";

export function Rail() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const t = useT();
  const ThemeIcon = themeIcon[theme];
  const nav = (id: Screen) => cx(itemCls, screen === id ? "bg-nav-active text-nav-active-fg" : idleCls);

  return (
    <nav aria-label={t("rail.sections")} className="flex w-20 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-surface py-3">
      <svg aria-label="Skillshelf" role="img" viewBox="0 0 24 24" className="mb-3 size-7 text-accent">
        <rect x="3" y="4" width="4" height="16" rx="1" fill="currentColor" />
        <rect x="9" y="7" width="4" height="13" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="15.5" y="5" width="4" height="15" rx="1" fill="currentColor" opacity="0.45" transform="rotate(-12 17.5 12.5)" />
        <rect x="2" y="20" width="20" height="1.6" rx="0.8" fill="currentColor" />
      </svg>
      {screens.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={screen === id ? "page" : undefined}
          onClick={() => setScreen(id)}
          className={nav(id)}
        >
          <Icon aria-hidden className="size-5" />
          {t(label)}
        </button>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        <button
          type="button"
          className={cx(itemCls, idleCls)}
          aria-label={t("rail.themeToggle", { current: t(`mode.${theme}`), next: t(`mode.${nextTheme[theme]}`) })}
          onClick={() => setTheme(nextTheme[theme])}
        >
          <ThemeIcon aria-hidden className="size-5" />
          {t(`mode.${theme}`)}
        </button>
        <button
          type="button"
          aria-current={screen === "settings" ? "page" : undefined}
          className={nav("settings")}
          onClick={() => setScreen("settings")}
        >
          <Settings aria-hidden className="size-5" />
          {t("rail.settings")}
        </button>
      </div>
    </nav>
  );
}
