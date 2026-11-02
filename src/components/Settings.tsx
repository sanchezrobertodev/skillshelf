import {
  Check,
  ExternalLink,
  FolderPlus,
  Info,
  Monitor,
  Moon,
  Palette as PaletteIcon,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { api, errorText, type ProjectPage } from "../api";
import { type LanguagePref, languages, resolveLanguage, type TKey, tx, useT } from "../i18n";
import { cx } from "../lib/cx";
import { type Palette, palettes, type Theme } from "../lib/prefs";
import { useStore } from "../store";
import type { Environment, Settings as SettingsData } from "../types";
import { AppUpdateSettings } from "./AppUpdate";
import { Button, card, IconButton, Switch } from "./ui";

const selectCls =
  "h-8 min-w-48 rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-fg hover:bg-surface-hover";

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Info; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(card, "px-5 py-4")}>
      <h2 id={id} className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
        <Icon aria-hidden className="size-4" />
        {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** A setting: label and help on the left, its control on the right. */
function Row({ label, help, htmlFor, children }: { label: string; help?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[13px] font-medium">
            {label}
          </label>
        ) : (
          <p className="text-[13px] font-medium">{label}</p>
        )}
        {help && <p className="mt-0.5 text-xs text-muted">{help}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const modeIcon: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

function ModePicker() {
  const t = useT();
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <div role="radiogroup" aria-label={t("settings.mode")} className="inline-flex rounded-lg border border-border-strong p-0.5">
      {(["system", "light", "dark"] as const).map((m) => {
        const Icon = modeIcon[m];
        return (
          <label
            key={m}
            className={cx(
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              theme === m ? "bg-nav-active font-medium text-nav-active-fg" : "text-muted hover:text-fg",
            )}
          >
            <input type="radio" name="mode" className="sr-only" checked={theme === m} onChange={() => setTheme(m)} />
            <Icon aria-hidden className="size-3.5" />
            {t(`mode.${m}`)}
          </label>
        );
      })}
    </div>
  );
}

/** A palette preview: the theme's own tokens apply inside an element carrying its data attributes. */
function PalettePicker() {
  const t = useT();
  const palette = useStore((s) => s.palette);
  const setPalette = useStore((s) => s.setPalette);
  const dark = document.documentElement.dataset.theme === "dark";
  useStore((s) => s.theme);
  return (
    <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-5 gap-3 pt-3 pb-1">
      {palettes.map((p: Palette) => (
        <label key={p} className="group cursor-pointer">
          <input type="radio" name="palette" className="peer sr-only" checked={palette === p} onChange={() => setPalette(p)} />
          <div
            data-palette={p}
            data-theme={dark ? "dark" : "light"}
            className={cx(
              "rounded-lg border-2 bg-bg p-2 transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
              palette === p ? "border-accent" : "border-transparent group-hover:border-border-strong",
            )}
          >
            <div aria-hidden className="flex gap-1.5 rounded-md border border-card-border bg-surface p-1.5 shadow-card">
              <div className="w-2 rounded-sm bg-nav-active" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="h-1.5 w-4/5 rounded-full bg-fg" />
                <div className="h-1.5 w-3/5 rounded-full bg-muted" />
                <div className="mt-1 flex gap-1">
                  <div className="h-2.5 w-6 rounded-sm bg-accent" />
                  <div className="h-2.5 w-4 rounded-sm bg-warn" />
                </div>
              </div>
            </div>
          </div>
          <span className="mt-1.5 flex items-center justify-center gap-1 text-xs">
            {palette === p && <Check aria-hidden className="size-3.5 text-accent" />}
            {t(`palette.${p}`)}
          </span>
        </label>
      ))}
    </div>
  );
}

function LinkButton({ page, label }: { page: ProjectPage; label: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={() => void api.openProjectPage(page)}>
      <ExternalLink aria-hidden className="size-3.5" />
      {label}
    </Button>
  );
}

export function Settings() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);
  const [env, setEnv] = useState<Environment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = { language: useId(), close: useId(), check: useId() };

  useEffect(() => {
    api.environment().then(setEnv, () => setEnv(null));
  }, []);

  const change = (patch: Partial<SettingsData>) => {
    setError(null);
    save({ ...settings, ...patch }).catch((e) => setError(t("settings.saveFailed", { error: errorText(e) })));
  };

  const setAutostart = (on: boolean) => {
    setError(null);
    api.setAutostart(on).then(
      () => setEnv((e) => e && { ...e, autostart: on }),
      (e) => setError(t("settings.saveFailed", { error: errorText(e) })),
    );
  };

  const addProject = async () => {
    const folder = await api.pickFolder().catch(() => null);
    if (folder && !settings.projects.includes(folder)) change({ projects: [...settings.projects, folder] });
  };

  const frequency = settings.autoCheck ? settings.checkInterval : "never";
  const tools: [string, string | null | undefined, TKey][] = [
    ["claude", env?.claude, "settings.tool.claude"],
    ["npx", env?.npx, "settings.tool.npx"],
    ["git", env?.git, "settings.tool.git"],
    ["gh", env?.gh, "settings.tool.gh"],
  ];
  const tray = env?.tray ?? true;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <Section title={t("settings.general")} icon={SlidersHorizontal}>
          <Row
            label={t("settings.language")}
            htmlFor={ids.language}
            help={tx("settings.languageHelp", {
              link: (
                <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => void api.openProjectPage("translate")}>
                  {t("settings.languageHelpLink")}
                </button>
              ),
            })}
          >
            <select
              id={ids.language}
              className={selectCls}
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguagePref)}
            >
              <option value="system">{t("settings.languageSystem", { language: languages[resolveLanguage("system")] })}</option>
              {Object.entries(languages).map(([code, name]) => (
                <option key={code} value={code} lang={code}>
                  {name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settings.close")} htmlFor={ids.close} help={tray ? t("settings.closeHelp") : t("settings.noTray")}>
            <select
              id={ids.close}
              className={selectCls}
              disabled={!tray}
              value={settings.closeToTray && tray ? "tray" : "quit"}
              onChange={(e) => change({ closeToTray: e.target.value === "tray" })}
            >
              <option value="tray">{t("settings.closeTray")}</option>
              <option value="quit">{t("settings.closeQuit")}</option>
            </select>
          </Row>
          <Row label={t("settings.autostart")} help={t("settings.autostartHelp")}>
            <Switch
              label={t("settings.autostart")}
              checked={!!env?.autostart}
              disabled={!env || !tray}
              onChange={() => setAutostart(!env?.autostart)}
            />
          </Row>
          <Row label={t("settings.notifications")} help={t("settings.notificationsHelp")}>
            <Switch
              label={t("settings.notifications")}
              checked={settings.notifications}
              onChange={() => change({ notifications: !settings.notifications })}
            />
          </Row>
        </Section>

        <Section title={t("settings.appearance")} icon={PaletteIcon}>
          <Row label={t("settings.mode")}>
            <ModePicker />
          </Row>
          <div className="py-3">
            <p className="text-[13px] font-medium">{t("settings.theme")}</p>
            <PalettePicker />
          </div>
        </Section>

        <Section title={t("settings.updates")} icon={RefreshCw}>
          <Row label={t("settings.checkEvery")} htmlFor={ids.check} help={t("settings.checkHelp")}>
            <select
              id={ids.check}
              className={selectCls}
              value={frequency}
              onChange={(e) => {
                const v = e.target.value;
                change(v === "never" ? { autoCheck: false } : { autoCheck: true, checkInterval: v as SettingsData["checkInterval"] });
              }}
            >
              <option value="daily">{t("settings.checkDaily")}</option>
              <option value="weekly">{t("settings.checkWeekly")}</option>
              <option value="never">{t("settings.checkNever")}</option>
            </select>
          </Row>
          <div className="pt-3 [&>section]:mb-1">
            <AppUpdateSettings version={env?.version} />
          </div>
        </Section>

        <Section title={t("settings.projects")} icon={FolderPlus}>
          <div className="py-3">
            <p className="mb-3 text-xs text-muted">{t("settings.projectsHelp")}</p>
            {settings.projects.length > 0 ? (
              <ul className="mb-3 divide-y divide-border rounded-md border border-border">
                {settings.projects.map((p) => (
                  <li key={p} className="flex items-center gap-2 py-1 pr-1 pl-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs" title={p}>
                      {p}
                    </code>
                    <IconButton
                      label={t("common.remove", { name: p })}
                      className="size-8"
                      onClick={() => change({ projects: settings.projects.filter((x) => x !== p) })}
                    >
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-muted italic">{t("settings.noProjects")}</p>
            )}
            <Button size="sm" onClick={() => void addProject()}>
              <FolderPlus aria-hidden className="size-4" />
              {t("settings.addFolder")}
            </Button>
          </div>
        </Section>

        <Section title={t("settings.about")} icon={Info}>
          <div className="py-3">
            <p className="mb-3 text-[13px] font-medium">
              {t("settings.version", { version: env?.version ?? "…", os: env?.os ?? "…" })}
            </p>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted">{t("settings.claudeDir")}</dt>
              <dd className="font-mono break-all">{env?.claudeDir ?? "…"}</dd>
              {tools.map(([name, path, why]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-muted">{name}</dt>
                  <dd className="min-w-0">
                    {path ? (
                      <span className="font-mono break-all">{path}</span>
                    ) : (
                      <span className="text-warn">{t("settings.notFound", { why: t(why) })}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 -ml-2.5 flex flex-wrap gap-1">
              <LinkButton page="repo" label={t("settings.source")} />
              <LinkButton page="issues" label={t("settings.reportProblem")} />
              <LinkButton page="changelog" label={t("settings.changelog")} />
              <LinkButton page="license" label={t("settings.license")} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
