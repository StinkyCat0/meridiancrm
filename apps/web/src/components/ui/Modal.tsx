import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { IconButton } from "./IconButton";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modals can stack (for example, a customer sheet that opens a location form).
 * Only the topmost panel should respond to Escape and trap Tab.
 */
const openModals: HTMLElement[] = [];

export type ModalSize = "sm" | "md" | "lg";

const sizeClasses: Record<ModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus();
    });

    const panel = panelRef.current;
    if (panel) openModals.push(panel);

    function handleKeyDown(event: KeyboardEvent) {
      if (panelRef.current !== openModals[openModals.length - 1]) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(
        (element) =>
          element.tabIndex !== -1 && element.getClientRects().length > 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const index = panel ? openModals.indexOf(panel) : -1;
      if (index !== -1) openModals.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="dialog-backdrop scrim absolute inset-0 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => {
          if (closeOnBackdrop) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "dialog-panel relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden",
          "rounded-t-hero border border-border bg-surface shadow-panel outline-none sm:rounded-panel",
          sizeClasses[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-medium tracking-tight text-fg"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-sm leading-relaxed text-muted"
              >
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            label="Close dialog"
            size="sm"
            onClick={() => onCloseRef.current()}
          >
            <X aria-hidden="true" />
          </IconButton>
        </div>
        {children ? (
          <div className="overflow-y-auto p-5">{children}</div>
        ) : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border p-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
