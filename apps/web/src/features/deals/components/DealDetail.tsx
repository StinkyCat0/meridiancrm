import type { Deal, Pipeline, Stage } from "@meridian/contracts";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../../../components/ui/Avatar";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { Skeleton } from "../../../components/ui/Skeleton";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn, formatDate, formatMoney, relativeTime } from "../../../lib/utils";
import { useDealDetail, useDealHistory } from "../hooks";
import {
  errorMessage,
  isOverdue,
  momentumMeta,
  stageKindTone,
} from "../lib/deals";
import { DealActivityFeed } from "./DealActivityFeed";
import { MomentumSegments } from "./MomentumMeter";

interface DealDetailProps {
  dealId: string | null;
  open: boolean;
  onClose: () => void;
  pipelines: Pipeline[];
  onEdit: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
  onMoveStage: (deal: Deal, stage: Stage) => void;
  canDelete: boolean;
}

export function DealDetail({
  dealId,
  open,
  onClose,
  pipelines,
  onEdit,
  onDelete,
  onMoveStage,
  canDelete,
}: DealDetailProps) {
  const detail = useDealDetail(dealId);
  const deal = detail.data;
  const history = useDealHistory(deal?.id ?? null);
  const stages = useMemo(() => {
    const pipeline =
      pipelines.find((row) => row.id === deal?.pipelineId) ??
      pipelines.find((row) => row.isDefault) ??
      pipelines[0];
    return pipeline
      ? [...pipeline.stages].sort((a, b) => a.order - b.order)
      : [];
  }, [pipelines, deal?.pipelineId]);
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));

  const footer = deal ? (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {canDelete ? (
        <Button variant="danger" onClick={() => onDelete(deal)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </Button>
      ) : (
        <Tooltip label="Only workspace admins can delete deals">
          <Button variant="danger" disabled>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
        </Tooltip>
      )}
      <Button variant="primary" onClick={() => onEdit(deal)}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit deal
      </Button>
    </div>
  ) : (
    <Button variant="ghost" onClick={onClose}>
      Close
    </Button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deal?.title ?? "Deal details"}
      description={
        deal
          ? `${deal.company?.name ?? "No company"} · ${deal.stage.name} stage`
          : "Loading deal details"
      }
      size="lg"
      footer={footer}
    >
      {detail.isPending ? (
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-24 w-full rounded-card" />
          <Skeleton className="h-36 w-full rounded-card" />
          <Skeleton className="h-28 w-full rounded-card" />
        </div>
      ) : detail.isError || !deal ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Couldn't load this deal"
          description={errorMessage(detail.error)}
          action={
            <Button variant="secondary" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="deal-summary-heading">
            <h3 id="deal-summary-heading" className="label-micro">
              Summary
            </h3>
            <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Value
                </dt>
                <dd className="num mt-0.5 text-lg font-light tracking-tight text-fg">
                  {formatMoney(deal.value, deal.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Stage
                </dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={stageKindTone(deal.stage.kind)}>
                    {deal.stage.name}
                  </Badge>
                  <span className="text-xs text-muted">
                    {deal.probability}% probability
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Owner
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  {deal.owner ? (
                    <>
                      <Avatar
                        name={deal.owner.name}
                        src={deal.owner.avatarUrl}
                        size="xs"
                      />
                      <span className="text-xs text-fg">{deal.owner.name}</span>
                    </>
                  ) : (
                    <>
                      <UserRound
                        className="size-3.5 text-muted"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-muted">Unassigned</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Expected close
                </dt>
                <dd
                  className={cn(
                    "mt-1 inline-flex items-center gap-1.5 text-xs",
                    isOverdue(deal.expectedCloseDate, deal.stage.kind)
                      ? "font-medium text-danger"
                      : "text-fg",
                  )}
                >
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  {deal.expectedCloseDate
                    ? formatDate(deal.expectedCloseDate)
                    : "Not set"}
                  {isOverdue(deal.expectedCloseDate, deal.stage.kind) ? (
                    <span className="text-[10px] uppercase tracking-[0.12em]">
                      Overdue
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Company
                </dt>
                <dd className="mt-1 text-xs">
                  {deal.company ? (
                    <Link
                      to={`/app/companies/${deal.company.id}`}
                      className="inline-flex items-center gap-1.5 text-fg underline-offset-2 hover:text-accent hover:underline"
                    >
                      <Building2
                        className="size-3.5 text-muted"
                        aria-hidden="true"
                      />
                      {deal.company.name}
                    </Link>
                  ) : (
                    <span className="text-muted">No company</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  Contact
                </dt>
                <dd className="mt-1 text-xs">
                  {deal.contact ? (
                    <Link
                      to={`/app/contacts/${deal.contact.id}`}
                      className="inline-flex items-center gap-1.5 text-fg underline-offset-2 hover:text-accent hover:underline"
                    >
                      <UserRound
                        className="size-3.5 text-muted"
                        aria-hidden="true"
                      />
                      {deal.contact.firstName} {deal.contact.lastName}
                    </Link>
                  ) : (
                    <span className="text-muted">No contact</span>
                  )}
                </dd>
              </div>
            </dl>

            {deal.description ? (
              <p className="mt-4 whitespace-pre-line rounded-card border border-border bg-surface-2/40 p-3 text-xs leading-relaxed text-muted">
                {deal.description}
              </p>
            ) : null}

            {deal.tags.length > 0 ? (
              <ul
                className="mt-3 flex flex-wrap gap-1.5"
                aria-label="Deal tags"
              >
                {deal.tags.map((tag) => (
                  <li key={tag}>
                    <Badge tone="neutral">{tag}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="deal-momentum-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="deal-momentum-heading" className="label-micro">
                Momentum
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "num text-lg font-light tracking-tight",
                    momentumMeta[deal.momentum.band].text,
                  )}
                >
                  {deal.momentum.score}
                  <span className="text-xs text-muted">/100</span>
                </span>
                <Badge tone={momentumMeta[deal.momentum.band].tone}>
                  {momentumMeta[deal.momentum.band].label}
                </Badge>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {`Momentum ${deal.momentum.score} of 100 — ${momentumMeta[deal.momentum.band].label}. ${momentumMeta[deal.momentum.band].description}`}
            </p>

            {deal.momentum.breakdown.length === 0 ? (
              <p className="mt-3 rounded-card border border-border bg-surface-2/40 p-3 text-xs leading-relaxed text-muted">
                Closed deals have a fixed momentum score, so there is no live
                breakdown.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {deal.momentum.breakdown.map((item) => (
                  <li key={item.key}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-fg">{item.label}</span>
                      <span className="num text-muted">
                        {item.points}/{item.max}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${item.label}: ${item.points} of ${item.max}`}
                      aria-valuemin={0}
                      aria-valuemax={item.max}
                      aria-valuenow={item.points}
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
                    >
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          momentumMeta[deal.momentum.band].bar,
                        )}
                        style={{
                          width: `${item.max > 0 ? (item.points / item.max) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      {item.detail}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <MomentumSegments momentum={deal.momentum} />
            </div>
          </section>

          <section aria-labelledby="deal-stage-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="deal-stage-heading" className="label-micro">
                Stage progress
              </h3>
              <span className="text-[10px] text-muted">
                Tap a stage to move this deal
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stages.map((stage) => {
                const current = stage.id === deal.stageId;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    disabled={current}
                    aria-pressed={current}
                    aria-label={
                      current
                        ? `${stage.name}, current stage`
                        : `Move deal to ${stage.name}`
                    }
                    onClick={() => onMoveStage(deal, stage)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      current
                        ? "cursor-default border-accent/40 bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-white/20 hover:text-fg",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        stage.kind === "WON"
                          ? "bg-success"
                          : stage.kind === "LOST"
                            ? "bg-danger"
                            : current
                              ? "bg-accent"
                              : "bg-muted/50",
                      )}
                    />
                    {stage.name}
                  </button>
                );
              })}
            </div>

            <h4 className="mt-5 text-[10px] font-black uppercase tracking-[0.16em] text-muted">
              Stage history
            </h4>
            {history.isPending ? (
              <div className="mt-2 space-y-2" aria-hidden="true">
                <Skeleton className="h-8 w-4/5" />
                <Skeleton className="h-8 w-3/5" />
              </div>
            ) : history.isError ? (
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Couldn&apos;t load stage history.{" "}
                <button
                  type="button"
                  onClick={() => void history.refetch()}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              </p>
            ) : (history.data ?? []).length === 0 ? (
              <p className="mt-2 text-xs text-muted">No stage changes yet.</p>
            ) : (
              <ol className="mt-2 space-y-3 border-l border-border pl-3">
                {(history.data ?? []).map((entry) => {
                  const fromName = entry.fromStageId
                    ? stageNames.get(entry.fromStageId)
                    : null;
                  return (
                    <li key={entry.id} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[15px] top-1.5 size-1.5 rounded-full bg-accent"
                      />
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs text-fg">
                          Moved to{" "}
                          <span className="font-medium">{entry.stageName}</span>
                          {fromName ? (
                            <span className="text-muted"> from {fromName}</span>
                          ) : null}
                        </p>
                        <span className="shrink-0 text-[10px] text-muted">
                          {relativeTime(entry.changedAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {entry.changedBy
                          ? `by ${entry.changedBy.name}`
                          : "Automatically"}{" "}
                        · {formatDate(entry.changedAt, "MMM d, yyyy · h:mm a")}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <DealActivityFeed deal={deal} />

          <p className="border-t border-border pt-3 text-[10px] text-muted">
            Created {formatDate(deal.createdAt)} · Last updated{" "}
            {relativeTime(deal.updatedAt)}
          </p>
        </div>
      )}
    </Modal>
  );
}
