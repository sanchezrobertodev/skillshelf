import { FolderPlus, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { sourceLabel, uninstallEffect } from "../lib/format";
import { useStore } from "../store";
import type { Environment, Item, Job } from "../types";
import { Button, IconButton, KindIcon, Modal } from "./ui";

function UninstallDialog({ items }: { items: Item[] }) {
  const confirm = useStore((s) => s.confirm);
  const run = useStore((s) => s.run);
  const close = () => confirm(null);
  const many = items.length > 1;
  return (
    <Modal
      title={many ? `Uninstall ${items.length} items?` : `Uninstall ${items[0].name}?`}
      onClose={close}
      footer={
        <>
          <Button data-autofocus onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              close();
              void run(items.map((i) => ({ itemId: i.id, action: "uninstall" as const })));
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Uninstall{many ? ` ${items.length}` : ""}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((i) => (
          <li key={i.id} className="flex gap-3 px-3 py-2.5">
            <KindIcon kind={i.kind} className="mt-0.5 size-4" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">
                {i.name} <span className="font-normal text-muted">· {sourceLabel[i.source]}</span>
              </div>
              <p className="text-xs text-muted">{uninstallEffect(i)}</p>
            </div>
          </li>
        ))}
      </ul>
      {items.some((i) => i.kind === "plugin") && (
        <p className="mt-3 text-xs text-muted">Restart Claude Code afterwards so it stops loading removed plugins.</p>
      )}
    </Modal>
  );
}

function CommandDialog({ job }: { job: Job }) {
  const confirm = useStore((s) => s.confirm);
  const run = useStore((s) => s.run);
  const close = () => confirm(null);
  return (
    <Modal
      wide
      title={`Review install command for ${job.itemName}`}
      onClose={close}
      footer={
        <>
          <Button data-autofocus onClick={close}>
            Don't run
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              void run([{ itemId: job.itemId, action: job.action, acceptCommand: job.confirm?.sha256 }]);
            }}
          >
            Run this command
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2 rounded-md border border-warn/35 bg-warn/10 px-3 py-2 text-[13px]">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>
          This plugin's marketplace runs its own command to install the update. It will run on your computer as you.
          Only continue if you trust this marketplace.
        </span>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg p-3 font-mono text-xs whitespace-pre-wrap">
        {job.confirm?.command}
      </pre>
      <p className="mt-2 font-mono text-[11px] break-all text-muted">sha256 {job.confirm?.sha256}</p>
    </Modal>
  );
}

export function ConfirmDialogs() {
  const confirmation = useStore((s) => s.confirmation);
  if (!confirmation) return null;
  return confirmation.type === "uninstall" ? (
    <UninstallDialog items={confirmation.items} />
  ) : (
    <CommandDialog job={confirmation.job} />
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const [draft, setDraft] = useState(settings);
  const [env, setEnv] = useState<Environment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setError(null);
    api.environment().then(setEnv, () => setEnv(null));
  }, [open, settings]);

  if (!open) return null;
  const close = () => setOpen(false);

  const addProject = async () => {
    const folder = await api.pickFolder().catch(() => null);
    if (folder && !draft.projects.includes(folder)) setDraft({ ...draft, projects: [...draft.projects, folder] });
  };

  const tools: [string, string | null | undefined, string][] = [
    ["claude", env?.claude, "Needed to list and update plugins"],
    ["npx", env?.npx, "Needed to update skills installed with the skills CLI"],
    ["git", env?.git, "Used to compare plugin versions"],
    ["gh", env?.gh, "Optional: raises the GitHub rate limit for update checks"],
  ];

  return (
    <Modal
      wide
      title="Settings"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              save(draft).then(close, (e) => {
                setError(errorText(e));
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <section className="mb-6">
        <h3 className="mb-1 text-[13px] font-semibold">Project folders</h3>
        <p className="mb-3 text-xs text-muted">Skills in each folder's .claude/skills are listed as Project items.</p>
        {draft.projects.length > 0 && (
          <ul className="mb-3 divide-y divide-border rounded-md border border-border">
            {draft.projects.map((p) => (
              <li key={p} className="flex items-center gap-2 py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={p}>
                  {p}
                </code>
                <IconButton
                  label={`Remove ${p}`}
                  className="size-8"
                  onClick={() => setDraft({ ...draft, projects: draft.projects.filter((x) => x !== p) })}
                >
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" onClick={() => void addProject()}>
          <FolderPlus aria-hidden className="size-4" />
          Add folder
        </Button>
      </section>

      <section className="mb-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.autoCheck}
            onChange={(e) => setDraft({ ...draft, autoCheck: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block text-[13px] font-semibold">Check for updates on launch</span>
            <span className="block text-xs text-muted">
              Refreshes marketplace catalogs and asks GitHub for the latest skill versions.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Environment</h3>
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted">Claude dir</dt>
          <dd className="font-mono break-all">{env?.claudeDir ?? "…"}</dd>
          {tools.map(([name, path, why]) => (
            <div key={name} className="contents">
              <dt className="font-mono text-muted">{name}</dt>
              <dd className="min-w-0">
                {path ? (
                  <span className="font-mono break-all">{path}</span>
                ) : (
                  <span className="text-warn">Not found. {why}.</span>
                )}
              </dd>
            </div>
          ))}
          <dt className="text-muted">Version</dt>
          <dd className="font-mono">
            Skillshelf {env?.version} · {env?.os}
          </dd>
        </dl>
      </section>
      {error && (
        <p role="alert" className="mt-4 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
