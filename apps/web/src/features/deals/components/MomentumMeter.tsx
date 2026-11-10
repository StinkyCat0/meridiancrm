import type { Momentum } from "@meridian/contracts";
import { Badge } from "../../../components/ui/Badge";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn } from "../../../lib/utils";
import { momentumMeta } from "../lib/deals";

interface MomentumSegmentsProps {
  momentum: Momentum;
  className?: string;
}

export function MomentumSegments({ momentum, className }: MomentumSegmentsProps) {
  const meta = momentumMeta[momentum.band];
  const filled = momentum.score >= 67 ? 3 : momentum.score >= 34 ? 2 : momentum.score > 0 ? 1 : 0;

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 w-4 rounded-full transition-colors",
            index < filled ? meta.bar : "bg-white/10",
          )}
        />
      ))}
    </span>
  );
}

interface MomentumMeterProps {
  momentum: Momentum;
  className?: string;
  showScore?: boolean;
  showBand?: boolean;
}

export function MomentumMeter({
  momentum,
  className,
  showScore = true,
  showBand = false,
}: MomentumMeterProps) {
  const meta = momentumMeta[momentum.band];

  return (
    <Tooltip label={`Momentum ${momentum.score}/100 · ${meta.label}`}>
      <span
        role="img"
        tabIndex={0}
        aria-label={`Momentum ${momentum.score} of 100, ${meta.label}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          className,
        )}
      >
        <MomentumSegments momentum={momentum} />
        {showScore ? (
          <span className="num text-[10px] font-medium text-muted">{momentum.score}</span>
        ) : null}
        {showBand ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
      </span>
    </Tooltip>
  );
}
