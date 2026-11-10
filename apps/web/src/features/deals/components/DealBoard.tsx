import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, Stage } from "@meridian/contracts";
import { useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Skeleton } from "../../../components/ui/Skeleton";
import { cn, formatMoney } from "../../../lib/utils";
import { stageKindLabel, stageKindTone } from "../lib/deals";
import { DealCard, DealCardPreview } from "./DealCard";

interface DealColumnProps {
  stage: Stage;
  deals: Deal[];
  currency: string;
  onOpenDeal: (deal: Deal) => void;
}

function DealColumn({ stage, deals, currency, onOpenDeal }: DealColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id } });
  const total = deals.reduce((sum, deal) => sum + deal.value, 0);
  const displayCurrency = deals[0]?.currency ?? currency;
  const kindLabel = stageKindLabel(stage.kind);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.name} stage`}
      className={cn(
        "flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col rounded-panel border bg-surface/30 sm:w-[300px]",
        stage.kind === "WON" && "border-success/20 bg-success/[0.02]",
        stage.kind === "LOST" && "border-danger/20 bg-danger/[0.02]",
        stage.kind === "OPEN" && "border-border",
        isOver && "border-accent/50 bg-accent/[0.04]",
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border/70 px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium text-fg">{stage.name}</h2>
            {kindLabel ? <Badge tone={stageKindTone(stage.kind)}>{kindLabel}</Badge> : null}
          </div>
          <p className="num mt-1 text-xs text-muted">{formatMoney(total, displayCurrency)}</p>
        </div>
        <span
          aria-label={`${deals.length} ${deals.length === 1 ? "deal" : "deals"}`}
          className="num shrink-0 rounded-full border border-border bg-white/5 px-2 py-0.5 text-[10px] text-muted"
        >
          {deals.length}
        </span>
      </header>

      <div className="flex min-h-[140px] flex-1 flex-col gap-2 p-2.5">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onOpen={onOpenDeal} />
        ))}
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-border/80 px-3 py-6 text-center">
            <p className="text-xs leading-relaxed text-muted/70">Drop a deal here</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface DealBoardProps {
  stages: Stage[];
  deals: Deal[];
  currency: string;
  onOpenDeal: (deal: Deal) => void;
  onMoveDeal: (deal: Deal, stage: Stage) => void;
}

export function DealBoard({ stages, deals, currency, onOpenDeal, onMoveDeal }: DealBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const activeDeal = activeId ? deals.find((deal) => deal.id === activeId) ?? null : null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over) return;
    const deal = deals.find((row) => row.id === event.active.id);
    const stage = stages.find((row) => row.id === event.over?.id);
    if (!deal || !stage || deal.stageId === stage.id) return;
    onMoveDeal(deal, stage);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div
        role="region"
        aria-label="Deals board"
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4"
      >
        {stages.map((stage) => (
          <DealColumn
            key={stage.id}
            stage={stage}
            deals={deals.filter((deal) => deal.stageId === stage.id)}
            currency={currency}
            onOpenDeal={onOpenDeal}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDeal ? <DealCardPreview deal={activeDeal} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DealBoardSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden pb-4" aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => (
        <div
          key={index}
          className="flex w-[84vw] max-w-[320px] shrink-0 flex-col rounded-panel border border-border bg-surface/30 sm:w-[300px]"
        >
          <div className="flex items-start justify-between gap-2 border-b border-border/70 px-3.5 py-3">
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="size-5 rounded-full" />
          </div>
          <div className="space-y-2 p-2.5">
            <Skeleton className="h-28 w-full rounded-card" />
            <Skeleton className="h-28 w-full rounded-card" />
          </div>
        </div>
      ))}
    </div>
  );
}
