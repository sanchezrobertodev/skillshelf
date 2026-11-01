import { Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";
import { formatBytes, sourceLabel, uninstallEffect } from "../lib/format";
import { useStore } from "../store";
import type { Item, Job } from "../types";
import { ReviewSheet } from "./ReviewSheet";
import { Button, KindIcon, Modal } from "./ui";

function UninstallDialog({ items }: { items: Item[] }) {
  const t = useT();
  const confirm = useStore((s) => s.confirm);
  const run = useStore((s) => s.run);
  const close = () => confirm(null);
  const many = items.length > 1;
  // Snapshot data from older builds has no dataBytes; treat undefined like null.
  const withData = items.filter((i) => i.dataBytes != null);
  const dataBytes = withData.reduce((n, i) => n + (i.dataBytes ?? 0), 0);
  const [deleteData, setDeleteData] = useState(false);
  return (
    <Modal
      title={many ? t("dialogs.uninstallMany", { count: items.length }) : t("dialogs.uninstallOne", { name: items[0].name })}
      onClose={close}
      footer={
        <>
          <Button data-autofocus onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              close();
              void run(items.map((i) => ({ itemId: i.id, action: "uninstall" as const, deleteData })));
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            {many ? t("dialogs.uninstallN", { count: items.length }) : t("dialogs.uninstall")}
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
      {withData.length > 0 && (
        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={deleteData}
            onChange={(e) => setDeleteData(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block text-[13px] font-semibold">{t("dialogs.deleteData", { size: formatBytes(dataBytes) })}</span>
            <span className="block text-xs text-muted">
              {many ? t("dialogs.dataKept", { count: withData.length }) : t("dialogs.dataKeptOne")} {t("dialogs.dataStays")}
            </span>
          </span>
        </label>
      )}
      {items.some((i) => i.kind === "plugin") && <p className="mt-3 text-xs text-muted">{t("dialogs.restart")}</p>}
    </Modal>
  );
}

function CommandDialog({ job }: { job: Job }) {
  const t = useT();
  const confirm = useStore((s) => s.confirm);
  const run = useStore((s) => s.run);
  const close = () => confirm(null);
  return (
    <Modal
      wide
      title={t("dialogs.commandTitle", { name: job.itemName })}
      onClose={close}
      footer={
        <>
          <Button data-autofocus onClick={close}>
            {t("dialogs.dontRun")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              void run([{ itemId: job.itemId, action: job.action, acceptCommand: job.confirm?.sha256 }]);
            }}
          >
            {t("dialogs.runCommand")}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2 rounded-md border border-warn/35 bg-warn/10 px-3 py-2 text-[13px]">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>{t("dialogs.commandWarning")}</span>
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
  switch (confirmation.type) {
    case "update":
      return <ReviewSheet items={confirmation.items} />;
    case "uninstall":
      return <UninstallDialog items={confirmation.items} />;
    case "command":
      return <CommandDialog job={confirmation.job} />;
  }
}
