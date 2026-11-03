import { createContext, useCallback, useContext, useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { RiCheckboxCircleFill, RiCheckLine, RiCloseLine, RiErrorWarningFill, RiFileCopyLine, RiInformationFill } from "@remixicon/react";
import { Dialog, Heading, Modal as AriaModal, ModalOverlay } from "react-aria-components";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import type { JobStatus } from "./api";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/** A titled surface, following BoardUI's card recipe (secondary background, 2xl radius). */
export function Card({
  title,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: IconComponent;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-4 rounded-2xl bg-background-secondary-default p-4", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-headline-medium text-text-primary">
            {Icon && <Icon className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />}
            <span className="truncate">{title}</span>
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("flex min-w-0 flex-col gap-3", bodyClassName)}>{children}</div>
    </section>
  );
}

const STATUS: Record<JobStatus, { label: string; color: "blue" | "lime" | "rose" | "gray" | "yellow" }> = {
  queued: { label: "Queued", color: "yellow" },
  running: { label: "Running", color: "blue" },
  succeeded: { label: "Succeeded", color: "lime" },
  failed: { label: "Failed", color: "rose" },
  cancelled: { label: "Cancelled", color: "gray" },
};

export function StatusChip({ status, compact = false }: { status: JobStatus; compact?: boolean }) {
  const s = STATUS[status];
  return (
    <Chip variant={compact ? "caption" : "bold"} color={s.color}>
      {status === "running" && <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {s.label}
    </Chip>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: IconComponent; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-button-default px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-2lg bg-background-tertiary-default">
        <Icon className="size-5 text-foreground-icon-secondary" aria-hidden />
      </span>
      <p className="text-body-medium text-text-primary">{title}</p>
      {children && <div className="max-w-md text-body-regular text-text-tertiary">{children}</div>}
    </div>
  );
}

/** Label and value pairs, two columns on wide screens. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value], i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-body-2-medium text-text-tertiary">{label}</dt>
          <dd className="min-w-0 break-words text-body-medium text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? RiErrorWarningFill : tone === "success" ? RiCheckboxCircleFill : RiInformationFill;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-body-medium",
        tone === "error" ? "border-border-error-default bg-background-tertiary-error text-text-error-primary" : "border-border-button-default bg-background-secondary-default text-text-primary",
      )}
    >
      <Icon className={cx("mt-0.5 size-5 shrink-0", tone === "success" ? "text-lime-500" : tone === "error" ? "" : "text-accent-500")} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A centred dialog built on React Aria's Modal, styled with BoardUI's surface tokens. */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-[2px] sm:items-center"
    >
      <AriaModal className={cx("max-h-[90dvh] w-full overflow-hidden rounded-3xl border border-border-button-default bg-background-secondary-default shadow-xl", wide ? "max-w-2xl" : "max-w-lg")}>
        <Dialog className="flex max-h-[90dvh] flex-col outline-none">
          <header className="flex items-center justify-between gap-3 border-b border-separator-border px-5 py-4">
            <Heading slot="title" className="text-title-3-semibold text-text-primary">
              {title}
            </Heading>
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-full p-1 text-foreground-icon-secondary hover:bg-background-tertiary-hover">
              <RiCloseLine className="size-5" aria-hidden />
            </button>
          </header>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-separator-border px-5 py-3">{footer}</footer>}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

/* ----------------------------------------------------------------- toasts */

type Toast = { id: number; tone: "success" | "error" | "info"; text: ReactNode };
const ToastContext = createContext<(tone: Toast["tone"], text: ReactNode) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: ReactNode) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 9000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end">
        {toasts.map((t) => {
          const Icon = t.tone === "error" ? RiErrorWarningFill : t.tone === "success" ? RiCheckboxCircleFill : RiInformationFill;
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3 text-body-medium text-text-primary shadow-lg"
            >
              <Icon className={cx("mt-0.5 size-5 shrink-0", t.tone === "error" ? "text-foreground-icon-error" : t.tone === "success" ? "text-lime-500" : "text-accent-500")} aria-hidden />
              <div className="min-w-0 flex-1 break-words">{t.text}</div>
              <button type="button" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} className="cursor-pointer text-foreground-icon-tertiary hover:text-foreground-icon-primary">
                <RiCloseLine className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (text: ReactNode) => push("success", text),
      error: (text: ReactNode) => push("error", text),
      info: (text: ReactNode) => push("info", text),
    }),
    [push],
  );
}

/** Runs an action, toasts its result, and reports whether it is still running. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<T>, success?: (result: T) => ReactNode): Promise<T | undefined> => {
      setBusy(key);
      try {
        const result = await action();
        const message = success?.(result);
        if (message) toast.success(message);
        return result;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

/* ------------------------------------------------------------ form helpers */

/** A BoardUI Select with a visible label above it (the base Select has none). */
export function SelectField({
  label,
  hint,
  selectedKey,
  onChange,
  children,
  className,
  isDisabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  selectedKey: string;
  onChange: (key: string) => void;
  children: ReactNode;
  className?: string;
  isDisabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span id={id} className="text-body-medium text-text-primary">
        {label}
      </span>
      <Select aria-labelledby={id} className="w-full" triggerClassName="w-full" popoverClassName="min-w-[var(--trigger-width)]" selectedKey={selectedKey} onSelectionChange={(k) => onChange(String(k))} isDisabled={isDisabled}>
        {children}
      </Select>
      {hint && <p className="text-body-2-regular text-text-tertiary">{hint}</p>}
    </div>
  );
}

/** Inline code, used for branch names, labels and config keys. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx("rounded-md bg-background-tertiary-default px-1.5 py-0.5 font-mono text-[0.85em] text-text-primary", className)}>{children}</code>;
}

/** Copies text, with a fallback for plain-HTTP origins where navigator.clipboard is missing. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy failed; select the text and copy it yourself");
  } finally {
    area.remove();
  }
}

export function CopyButton({ text, label = "Copy", size = "small" }: { text: string; label?: string; size?: "small" | "xs" | "medium" }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      leadingIcon={done ? RiCheckLine : RiFileCopyLine}
      onClick={async () => {
        try {
          await copyText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

/**
 * A button that asks before it acts. Use it for steps that are hard to undo:
 * cancelling a job, deleting a secret, regenerating the MCP token.
 */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel,
  onConfirm,
  variant = "secondary",
  danger = false,
  size = "medium",
  icon,
  disabled,
}: {
  label: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  danger?: boolean;
  size?: "medium" | "small" | "xs";
  icon?: IconComponent;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} leadingIcon={icon} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        isOpen={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button
              type="button"
              variant={danger ? "danger" : "primary"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
            >
              {busy ? "Working…" : confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-body-regular text-text-secondary">{message}</div>
      </Modal>
    </>
  );
}

/** A skeleton block while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-2xl bg-background-secondary-default", className)} aria-hidden />;
}
