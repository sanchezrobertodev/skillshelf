import clsx from "clsx";
import {
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  Building2,
  FolderSymlink,
  Clock,
  LoaderCircle,
  Puzzle,
  ScrollText,
  X,
} from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { statusLabel } from "../lib/format";
import type { Kind, Status } from "../types";

type Variant = "primary" | "update" | "secondary" | "ghost" | "danger";

/** A floating surface on the tinted canvas: lists, panels, overview tiles. */
export const card = "card rounded-2xl border border-card-border bg-surface shadow-card";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "btn-primary bg-accent text-accent-fg hover:enabled:bg-accent-hover",
        variant === "update" && "bg-warn text-warn-fg hover:enabled:bg-warn-hover",
        variant === "secondary" && "border border-border-strong bg-surface text-fg hover:enabled:bg-surface-hover",
        variant === "ghost" && "text-fg hover:enabled:bg-surface-hover",
        variant === "danger" && "border border-danger/50 bg-surface text-danger hover:enabled:bg-danger/10",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const statusStyle: Record<Status, { icon: typeof CircleCheck; cls: string }> = {
  updateAvailable: { icon: CircleArrowUp, cls: "text-warn bg-warn/12 border-warn/35" },
  error: { icon: CircleAlert, cls: "text-danger bg-danger/10 border-danger/35" },
  unknown: { icon: CircleHelp, cls: "text-muted bg-surface-2 border-border" },
  unchecked: { icon: Clock, cls: "text-muted bg-surface-2 border-border" },
  upToDate: { icon: CircleCheck, cls: "text-accent bg-accent/10 border-accent/30" },
  managed: { icon: Building2, cls: "text-info bg-info/10 border-info/30" },
  untracked: { icon: CircleDashed, cls: "text-muted bg-surface-2 border-border" },
  moved: { icon: FolderSymlink, cls: "text-info bg-info/10 border-info/30" },
  removed: { icon: CircleMinus, cls: "text-danger bg-danger/10 border-danger/35" },
};

export function StatusBadge({ status, checking, title }: { status: Status; checking?: boolean; title?: string | null }) {
  const t = useT();
  const pending = checking && status === "unchecked";
  const { icon: Icon, cls } = statusStyle[status];
  return (
    <span
      title={title ?? undefined}
      className={clsx(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        pending ? statusStyle.unchecked.cls : cls,
      )}
    >
      {pending ? (
        <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Icon aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{pending ? t("ui.checking") : statusLabel[status]}</span>
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = kind === "plugin" ? Puzzle : ScrollText;
  return <Icon aria-hidden className={clsx("shrink-0", kind === "plugin" ? "text-info" : "text-accent", className)} />;
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      tabIndex={-1}
      className="size-4 cursor-pointer rounded accent-[var(--accent)]"
    />
  );
}

/** On/off toggle. Inside the list grid it's skipped by Tab like the row checkboxes; the row's menu has the same action. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  tabIndex,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-border-strong bg-surface-2",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "size-3.5 rounded-full shadow-sm transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-[18px] bg-accent-fg" : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-surface-2 px-1.5 py-px font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  // Callers pass a new onClose each render; a ref keeps re-renders from re-running the focus setup.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Two lookups: one selector list would return whichever comes first in the DOM (the Close button).
    (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("button, input"))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex='0']")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, []);

  // Portalled to <body>: a frosted .card (backdrop-filter) would otherwise contain this fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "flex max-h-[85vh] w-full flex-col rounded-xl border border-card-border bg-surface shadow-2xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id="modal-title" className="text-base font-semibold">
            {title}
          </h2>
          <IconButton label={t("common.close")} onClick={onClose} className="-mr-2">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
