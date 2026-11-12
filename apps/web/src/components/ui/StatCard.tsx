import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Card } from "./Card";

export interface StatTrend {
  value: number;
  label?: string;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: StatTrend;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  className,
}: StatCardProps) {
  const positive = trend ? trend.value >= 0 : false;

  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="label-micro">{label}</p>
        {icon ? (
          <span
            className="flex size-8 items-center justify-center rounded-input border border-border bg-surface-2 text-muted [&_svg]:size-4"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="num mt-3 text-2xl font-light tracking-tight text-fg sm:text-[28px]">
        {value}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              positive ? "text-success" : "text-danger",
            )}
          >
            {positive ? (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="size-3.5" aria-hidden="true" />
            )}
            {Math.abs(trend.value)}%
          </span>
        ) : null}
        {hint ? <span className="text-muted">{hint}</span> : null}
      </div>
    </Card>
  );
}
