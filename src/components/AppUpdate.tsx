import { CircleAlert, CircleArrowUp, CircleCheck, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useAppUpdate } from "../appUpdate";
import type { CloneStatus, DownloadProgress } from "../types";
import { Markdown } from "./Markdown";
import { Button, IconButton, Modal } from "./ui";

function percent(p: DownloadProgress | null): number | null {
  return p?.total ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : null;
}

function progressText(p: DownloadProgress | null): string {
  if (!p) return "Starting download…";
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  const pct = percent(p);
  if (pct === 100) return "Installing…";
  return p.total ? `Downloading ${mb(p.downloaded)} of ${mb(p.total)} MB (${pct}%)` : `Downloading ${mb(p.downloaded)} MB`;
}

function ProgressBar({ progress }: { progress: DownloadProgress | null }) {
  const pct = percent(progress);
  return (
    <div
      role="progressbar"
      aria-label="Update download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
        style={{ width: `${pct ?? 0}%` }}
      />
    </div>
  );
}

export function ReleaseNotes({ notes }: { notes: string }) {
  return <Markdown text={notes} className="text-[13px]" />;
}

const commits = (n: number) => `${n} new commit${n === 1 ? "" : "s"}`;

/** What a clone update would bring in. */
function CloneCommits({ clone }: { clone: CloneStatus }) {
  return (
    <ul className="space-y-1 text-[13px]">
      {clone.commits.map((c) => {
        const [sha, ...msg] = c.split(" ");
        return (
          <li key={c} className="flex gap-2">
            <span className="shrink-0 font-mono text-xs text-muted">{sha}</span>
            <span className="min-w-0">{msg.join(" ")}</span>
          </li>
        );
      })}
      {clone.behind > clone.commits.length && <li className="text-xs text-muted">and {clone.behind - clone.commits.length} more</li>}
    </ul>
  );
}

/** Non-blocking strip under the toolbar: update found, download progress, or an install error. */
export function AppUpdateBanner() {
  const { phase, update, clone, log, progress, error, installFailed, dismissed, install, dismiss, setNotesOpen } = useAppUpdate();

  if (phase === "installing") {
    return (
      <div role="status" className="mx-5 mb-3 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[13px]">
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-accent" />
        {clone ? (
          <>
            <span className="shrink-0 font-medium">Updating Skillshelf from {clone.defaultBranch}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{log[log.length - 1] ?? "Starting…"}</span>
          </>
        ) : (
          <>
            <span className="shrink-0 font-medium">Updating to Skillshelf {update?.version}</span>
            <div className="max-w-64 min-w-24 flex-1">
              <ProgressBar progress={progress} />
            </div>
            <span className="truncate text-muted">{progressText(progress)}</span>
          </>
        )}
      </div>
    );
  }

  if (phase === "error" && installFailed) {
    return (
      <div role="alert" className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px]">
        <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1">
          {clone ? "Couldn't update Skillshelf" : `Couldn't install Skillshelf ${update?.version}`}: {error}
        </span>
        <Button size="sm" onClick={() => void install()}>
          <RefreshCw aria-hidden className="size-3.5" />
          Retry
        </Button>
        <IconButton label="Dismiss" className="-my-1 size-7" onClick={() => useAppUpdate.setState({ phase: "available", dismissed: true })}>
          <X className="size-3.5" />
        </IconButton>
      </div>
    );
  }

  // A blocked clone (another branch, local work) is the developer's own business; Settings explains it.
  if (clone) {
    if (phase !== "available" || clone.blocked || dismissed) return null;
    return (
      <div role="status" className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[13px]">
        <CircleArrowUp aria-hidden className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">
            {commits(clone.behind)} on {clone.defaultBranch}.
          </span>{" "}
          <span className="text-muted">Updating pulls them and rebuilds Skillshelf.</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => setNotesOpen(true)}>
          What's new
        </Button>
        <Button size="sm" variant="primary" onClick={() => void install()}>
          Update & restart
        </Button>
        <IconButton label="Remind me later" className="-my-1 size-7" onClick={dismiss}>
          <X className="size-3.5" />
        </IconButton>
      </div>
    );
  }
  if (phase !== "available" || !update || dismissed) return null;
  return (
    <div role="status" className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[13px]">
      <CircleArrowUp aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Skillshelf {update.version} is available.</span>{" "}
        <span className="text-muted">You have {update.currentVersion}.</span>
      </span>
      {update.notes && (
        <Button size="sm" variant="ghost" onClick={() => setNotesOpen(true)}>
          What's new
        </Button>
      )}
      <Button size="sm" variant="primary" onClick={() => void install()}>
        Install & restart
      </Button>
      <IconButton label="Remind me later" className="-my-1 size-7" onClick={dismiss}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}

export function ReleaseNotesDialog() {
  const { notesOpen, update, clone, install, setNotesOpen } = useAppUpdate();
  const close = () => setNotesOpen(false);
  if (notesOpen && clone)
    return (
      <Modal
        title={clone.behind ? `New on ${clone.defaultBranch}` : "Skillshelf is up to date"}
        onClose={close}
        footer={
          <>
            <Button data-autofocus onClick={close}>
              {clone.behind && !clone.blocked ? "Later" : "Close"}
            </Button>
            {clone.behind > 0 && !clone.blocked && (
              <Button variant="primary" onClick={() => void install()}>
                Update & restart
              </Button>
            )}
          </>
        }
      >
        {clone.behind ? <CloneCommits clone={clone} /> : <p className="text-[13px] text-muted">Your clone has everything on origin/{clone.defaultBranch}.</p>}
        {clone.blocked && <p className="mt-3 text-[13px] text-danger">{clone.blocked}</p>}
      </Modal>
    );
  if (!notesOpen || !update) return null;
  return (
    <Modal
      title={`What's new in Skillshelf ${update.version}`}
      onClose={close}
      footer={
        <>
          <Button data-autofocus onClick={close}>
            Later
          </Button>
          <Button variant="primary" onClick={() => void install()}>
            Install & restart
          </Button>
        </>
      }
    >
      {update.notes ? <ReleaseNotes notes={update.notes} /> : <p className="text-[13px] text-muted">No release notes.</p>}
    </Modal>
  );
}

/** "App updates" section of the Settings dialog. */
export function AppUpdateSettings({ version }: { version: string | undefined }) {
  const { phase, update, clone, progress, error, installFailed, check, install } = useAppUpdate();
  if (clone) return <CloneSettings clone={clone} />;

  let status: ReactNode = null;
  if (phase === "checking") status = <span className="text-muted">Checking…</span>;
  else if (phase === "upToDate")
    status = (
      <span className="inline-flex items-center gap-1 text-accent">
        <CircleCheck aria-hidden className="size-3.5" />
        You have the latest version.
      </span>
    );
  else if (phase === "available" && update)
    status = <span className="font-medium text-accent">Version {update.version} is available.</span>;
  else if (phase === "installing") status = <span className="text-muted">{progressText(progress)}</span>;
  else if (phase === "error")
    status = (
      <span className="text-danger">
        {installFailed ? "Couldn't install the update" : "Couldn't check for updates"}: {error}
      </span>
    );

  return (
    <section className="mb-6">
      <h3 className="mb-1 text-[13px] font-semibold">App updates</h3>
      <p className="mb-3 text-xs text-muted">
        Skillshelf {version ?? "…"} checks GitHub Releases for a new version on launch. Updates are signed and verified
        before they install.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={phase === "checking" || phase === "installing"} onClick={() => void check()}>
          <RefreshCw aria-hidden className={phase === "checking" ? "size-4 animate-spin" : "size-4"} />
          Check for updates
        </Button>
        {phase === "available" && update && (
          <Button size="sm" variant="primary" onClick={() => void install()}>
            Install & restart
          </Button>
        )}
        {status && (
          <p role="status" className="min-w-0 text-xs">
            {status}
          </p>
        )}
      </div>
      {phase === "installing" && (
        <div className="mt-3">
          <ProgressBar progress={progress} />
        </div>
      )}
      {phase === "available" && update?.notes && (
        <details className="mt-3 rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted hover:text-fg">
            What's new in {update.version}
          </summary>
          <div className="max-h-56 overflow-y-auto border-t border-border px-3 pt-3">
            <ReleaseNotes notes={update.notes} />
          </div>
        </details>
      )}
    </section>
  );
}

function CloneSettings({ clone }: { clone: CloneStatus }) {
  const { phase, log, error, installFailed, check, install } = useAppUpdate();
  const updatable = phase === "available" && clone.behind > 0 && !clone.blocked;
  let status: ReactNode = null;
  if (phase === "checking") status = <span className="text-muted">Fetching origin…</span>;
  else if (phase === "installing") status = <span className="text-muted">Updating…</span>;
  else if (phase === "error")
    status = (
      <span className="text-danger">
        {installFailed ? "Couldn't update" : "Couldn't check origin"}: {error}
      </span>
    );
  else if (!clone.behind)
    status = (
      <span className="inline-flex items-center gap-1 text-accent">
        <CircleCheck aria-hidden className="size-3.5" />
        Up to date with origin/{clone.defaultBranch}.
      </span>
    );
  else status = <span className="font-medium text-accent">{commits(clone.behind)} on {clone.defaultBranch}.</span>;

  return (
    <section className="mb-6">
      <h3 className="mb-1 text-[13px] font-semibold">App updates</h3>
      <p className="mb-3 text-xs text-muted">
        Skillshelf runs from your clone at <span className="font-mono break-all">{clone.dir}</span>. It checks origin/{clone.defaultBranch} on
        launch and once a day. Updating runs git pull, npm ci and a release build, then reopens Skillshelf.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={phase === "checking" || phase === "installing"} onClick={() => void check()}>
          <RefreshCw aria-hidden className={phase === "checking" ? "size-4 animate-spin" : "size-4"} />
          Check for updates
        </Button>
        {updatable && (
          <Button size="sm" variant="primary" onClick={() => void install()}>
            Update & restart
          </Button>
        )}
        <p role="status" className="min-w-0 text-xs">
          {status}
        </p>
      </div>
      {clone.blocked && phase !== "checking" && (
        <p className="mt-2 flex gap-1.5 text-xs text-danger">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {clone.blocked}
        </p>
      )}
      {clone.behind > 0 && phase === "available" && (
        <details className="mt-3 rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted hover:text-fg">What's new</summary>
          <div className="max-h-56 overflow-y-auto border-t border-border p-3">
            <CloneCommits clone={clone} />
          </div>
        </details>
      )}
      {log.length > 0 && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted">
          {log.join("\n")}
        </pre>
      )}
    </section>
  );
}
