import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface/40 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span
          className="mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
