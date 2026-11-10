import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type BadgeTone = "neutral" | "accent" | "violet" | "success" | "warning" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-white/5 text-muted",
  accent: "border-accent/25 bg-accent/10 text-accent",
  violet: "border-accent-2/25 bg-accent-2/10 text-accent-2",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5",
        "text-[10px] font-black uppercase leading-4 tracking-[0.16em]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
