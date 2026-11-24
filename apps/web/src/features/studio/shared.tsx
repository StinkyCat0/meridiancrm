import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

const WEBSITE_ORIGIN = (
  (import.meta.env.VITE_WEBSITE_URL as string | undefined) ??
  (import.meta.env.VITE_WEBSITE_PUBLIC_URL as string | undefined) ??
  ""
).replace(/\/+$/, "");

/** Public website root, used for demo and account links. */
export const STUDIO_WEBSITE_ORIGIN =
  WEBSITE_ORIGIN || "https://meridianstudios.org";

export function websiteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${STUDIO_WEBSITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export function integrationTone(status: string): BadgeTone {
  switch (status) {
    case "up":
    case "enabled":
    case "configured":
      return "success";
    case "down":
      return "danger";
    case "disabled":
    case "missing":
      return "warning";
    default:
      return "neutral";
  }
}

export function planTone(plan: string): BadgeTone {
  switch (plan) {
    case "pro":
      return "accent";
    case "enterprise":
      return "violet";
    case "basic":
      return "neutral";
    default:
      return "neutral";
  }
}

export function subscriptionTone(status: string): BadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "trialing":
      return "accent";
    case "past_due":
      return "danger";
    default:
      return "neutral";
  }
}

export function humanize(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StudioErrorCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
          {apiErrorMessage(error)}
        </p>
        {onRetry ? (
          <Button variant="secondary" className="mt-4" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function StudioSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  pending = false,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-accent/40 bg-accent/80"
          : "border-border bg-white/10 hover:bg-white/15",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "ml-0.5 size-4 rounded-full bg-white shadow transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function StudioPagination({
  page,
  pageSize,
  total,
  onPage,
  disabled = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="num text-xs text-muted">
        {total === 0 ? "No results" : `${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous page"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <span className="num px-2 text-xs text-muted">
          {page} / {totalPages}
        </span>
        <IconButton
          label="Next page"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
