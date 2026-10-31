import clsx from "clsx";
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleSlash, Clock, LoaderCircle, ShieldQuestion, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { Action, Job } from "../types";
import { Button, card } from "./ui";

const actionLabel: Record<Action, string> = {
  update: "Update",
  enable: "Enable",
  disable: "Disable",
  uninstall: "Uninstall",
  reinstall: "Reinstall",
};

const stateMeta: Record<Job["state"], { label: string; icon: typeof Clock; cls: string }> = {
  queued: { label: "Queued", icon: Clock, cls: "text-muted" },
  running: { label: "Running", icon: LoaderCircle, cls: "text-info" },
  success: { label: "Done", icon: CircleCheck, cls: "text-accent" },
  failed: { label: "Failed", icon: CircleAlert, cls: "text-danger" },
  needsConfirmation: { label: "Needs review", icon: ShieldQuestion, cls: "text-warn" },
  cancelled: { label: "Stopped", icon: CircleSlash, cls: "text-muted" },
};

function JobRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(job.state === "failed");
  const confirm = useStore((s) => s.confirm);
  const log = useRef<HTMLPreElement>(null);
  const meta = stateMeta[job.state];
  const Icon = meta.icon;

  useEffect(() => {
    if (job.state === "failed") setOpen(true);
  }, [job.state]);
  useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [open, job.logs.length]);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex h-10 items-center gap-3 px-4 text-[13px]">
        <Icon aria-hidden className={clsx("size-4 shrink-0", meta.cls, job.state === "running" && "animate-spin")} />
        <span className="w-20 shrink-0 text-muted">{actionLabel[job.action]}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{job.itemName}</span>
        <span className={clsx("hidden max-w-[40%] truncate text-xs sm:inline", job.state === "failed" ? "text-danger" : "text-muted")} title={job.message ?? undefined}>
          {job.message ?? meta.label}
        </span>
        {job.state === "needsConfirmation" && (
          <Button size="sm" onClick={() => confirm({ type: "command", job })}>
            Review
          </Button>
        )}
        {job.logs.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-fg"
          >
            {open ? "Hide log" : "Log"}
          </button>
        )}
      </div>
      {open && job.logs.length > 0 && (
        <pre
          ref={log}
          className="mx-4 mb-3 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted"
        >
          {job.logs.join("\n")}
        </pre>
      )}
    </li>
  );
}

export function QueueDrawer() {
  const jobs = useStore((s) => s.jobs);
  const open = useStore((s) => s.queueOpen);
  const setOpen = useStore((s) => s.setQueueOpen);
  const clear = useStore((s) => s.clearFinishedJobs);
  const stop = useStore((s) => s.stop);
  const batchFrom = useStore((s) => s.batchFrom);
  const attention = (j: Job) => (j.state === "failed" || j.state === "needsConfirmation" ? 0 : 1);
  const list = Object.values(jobs).sort((a, b) => attention(a) - attention(b) || b.jobId - a.jobId);
  if (!list.length) return null;

  const active = list.filter((j) => j.state === "queued" || j.state === "running").length;
  const failed = list.filter((j) => j.state === "failed").length;
  const done = list.filter((j) => j.state === "success").length;
  const batch = list.filter((j) => j.jobId >= batchFrom);
  const batchDone = batch.length - batch.filter((j) => j.state === "queued" || j.state === "running").length;

  return (
    <section aria-label="Action queue" className={clsx("mx-5 mb-4 shrink-0 overflow-hidden", card)}>
      <div className="flex h-10 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded text-[13px] font-medium"
        >
          {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}
          Activity
        </button>
        <span className="flex items-center gap-3 text-xs text-muted" aria-live="polite">
          {active > 0 && (
            <span className="flex items-center gap-1 text-info">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {active} left
            </span>
          )}
          {done > 0 && <span>{done} done</span>}
          {failed > 0 && <span className="text-danger">{failed} failed</span>}
        </span>
        {active > 0 && batch.length > 1 && (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
            <span className="shrink-0 tabular-nums">
              {Math.min(batchDone + 1, batch.length)} of {batch.length}
            </span>
            <div
              role="progressbar"
              aria-label="Batch progress"
              aria-valuemin={0}
              aria-valuemax={batch.length}
              aria-valuenow={batchDone}
              aria-valuetext={`${batchDone} of ${batch.length} finished`}
              className="h-1.5 max-w-48 flex-1 overflow-hidden rounded-full bg-border"
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(batchDone / batch.length) * 100}%` }} />
            </div>
          </div>
        )}
        <span className="ml-auto flex items-center gap-1">
          {active > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void stop()}>
              <Square aria-hidden className="size-3 fill-current" />
              Stop
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={active === list.length} onClick={clear}>
            Clear finished
          </Button>
        </span>
      </div>
      {open && <ul className="max-h-64 overflow-y-auto border-t border-border">{list.map((j) => <JobRow key={j.jobId} job={j} />)}</ul>}
    </section>
  );
}
