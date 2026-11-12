import { useDraggable } from "@dnd-kit/core";
import type { Deal } from "@meridian/contracts";
import { CalendarDays, GripVertical, UserRound } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { Badge } from "../../../components/ui/Badge";
import { cn, formatDate, formatMoney } from "../../../lib/utils";
import {
  dealSubtitle,
  isOverdue,
  stageKindLabel,
  stageKindTone,
} from "../lib/deals";
import { MomentumMeter, MomentumSegments } from "./MomentumMeter";

interface DealCardProps {
  deal: Deal;
  onOpen: (deal: Deal) => void;
}

export function DealCard({ deal, onOpen }: DealCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id },
  });
  const overdue = isOverdue(deal.expectedCloseDate, deal.stage.kind);
  const kindLabel = stageKindLabel(deal.stage.kind);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative rounded-card border border-border bg-surface p-3.5 pr-9 transition-colors",
        "hover:border-white/15",
        deal.stage.kind === "WON" && "border-l-2 border-l-success/60",
        deal.stage.kind === "LOST" && "border-l-2 border-l-danger/50",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(deal)}
        aria-label={`Open deal ${deal.title}`}
        className="absolute inset-0 z-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      />

      <div className="pointer-events-none relative z-10 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-snug text-fg">
              {deal.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {dealSubtitle(deal)}
            </p>
          </div>
          {kindLabel ? (
            <Badge tone={stageKindTone(deal.stage.kind)}>{kindLabel}</Badge>
          ) : null}
        </div>

        <p className="num text-base font-light tracking-tight text-fg">
          {formatMoney(deal.value, deal.currency)}
        </p>

        <div className="flex items-center justify-between gap-2">
          <span className="pointer-events-auto">
            <MomentumMeter momentum={deal.momentum} />
          </span>
          <span
            aria-label={
              deal.expectedCloseDate
                ? `Close date ${formatDate(deal.expectedCloseDate)}${overdue ? ", overdue" : ""}`
                : "No close date"
            }
            className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              overdue ? "font-medium text-danger" : "text-muted",
            )}
          >
            <CalendarDays className="size-3" aria-hidden="true" />
            {deal.expectedCloseDate
              ? formatDate(deal.expectedCloseDate, "MMM d")
              : "No close date"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {deal.owner ? (
              <Avatar
                name={deal.owner.name}
                src={deal.owner.avatarUrl}
                size="xs"
              />
            ) : (
              <span
                role="img"
                aria-label="Unassigned owner"
                className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted"
              >
                <UserRound className="size-3" aria-hidden="true" />
              </span>
            )}
            <span className="truncate text-[11px] text-muted">
              {deal.owner?.name ?? "Unassigned"}
            </span>
          </div>
          <span className="num shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted">
            {deal.probability}%
          </span>
        </div>
      </div>

      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Drag deal ${deal.title}`}
        className={cn(
          "pointer-events-auto absolute right-1.5 top-1.5 z-20 inline-flex size-7 touch-none items-center justify-center",
          "rounded-input text-muted transition-colors hover:bg-white/5 hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          "cursor-grab active:cursor-grabbing",
        )}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function DealCardPreview({ deal }: { deal: Deal }) {
  return (
    <div
      aria-hidden="true"
      className="w-[280px] cursor-grabbing rounded-card border border-accent/50 bg-surface p-3.5 shadow-panel"
    >
      <p className="truncate text-sm font-medium text-fg">{deal.title}</p>
      <p className="mt-0.5 truncate text-xs text-muted">{dealSubtitle(deal)}</p>
      <p className="num mt-2 text-base font-light text-fg">
        {formatMoney(deal.value, deal.currency)}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <MomentumSegments momentum={deal.momentum} />
        <span className="text-[11px] text-muted">{deal.stage.name}</span>
      </div>
    </div>
  );
}
