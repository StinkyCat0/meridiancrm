import { cn } from "../../lib/utils";

/** Shared surface treatment for text inputs, selects and textareas. */
export function controlClassName(invalid = false, className?: string): string {
  return cn(
    "w-full rounded-input border bg-surface-2 text-sm text-fg placeholder:text-muted/50",
    "transition-colors duration-150",
    "focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
    invalid
      ? "border-danger/60 focus:border-danger/70 focus:ring-danger/20"
      : "border-border hover:border-white/15 focus:border-accent/60 focus:ring-accent/20",
    className,
  );
}
