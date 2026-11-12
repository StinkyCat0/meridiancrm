import type { Deal } from "@meridian/contracts";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  UserRound,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Avatar } from "../../../components/ui/Avatar";
import { Badge } from "../../../components/ui/Badge";
import { Skeleton } from "../../../components/ui/Skeleton";
import { cn, formatDate, formatMoney } from "../../../lib/utils";
import { isOverdue, stageKindTone } from "../lib/deals";
import { MomentumMeter } from "./MomentumMeter";

export type DealSortKey = "value" | "expectedCloseDate";

interface SortHeaderProps {
  label: string;
  field: DealSortKey;
  sort: string;
  order: "asc" | "desc";
  onSort: (field: DealSortKey) => void;
  align?: "left" | "right";
}

function SortHeader({
  label,
  field,
  sort,
  order,
  onSort,
  align = "left",
}: SortHeaderProps) {
  const active = sort === field;
  const ariaSort = active
    ? order === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const Icon = !active
    ? ChevronsUpDown
    : order === "asc"
      ? ChevronUp
      : ChevronDown;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn("px-4 py-3", align === "right" && "text-right")}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label}${active ? `, currently ${order === "asc" ? "ascending" : "descending"}` : ""}`}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors",
          active ? "text-fg" : "text-muted hover:text-fg",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden="true" />
      </button>
    </th>
  );
}

interface DealTableProps {
  deals: Deal[];
  sort: string;
  order: "asc" | "desc";
  onSort: (field: DealSortKey) => void;
  onOpenDeal: (deal: Deal) => void;
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  deal: Deal,
  onOpenDeal: (deal: Deal) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onOpenDeal(deal);
}

export function DealTable({
  deals,
  sort,
  order,
  onSort,
  onOpenDeal,
}: DealTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <caption className="sr-only">All deals in the pipeline</caption>
        <thead>
          <tr className="border-b border-border bg-white/[0.02]">
            <th scope="col" className="px-4 py-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
                Deal
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
                Company
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
                Stage
              </span>
            </th>
            <SortHeader
              label="Value"
              field="value"
              sort={sort}
              order={order}
              onSort={onSort}
              align="right"
            />
            <th scope="col" className="px-4 py-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
                Momentum
              </span>
            </th>
            <SortHeader
              label="Close date"
              field="expectedCloseDate"
              sort={sort}
              order={order}
              onSort={onSort}
            />
            <th scope="col" className="px-4 py-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
                Owner
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const overdue = isOverdue(deal.expectedCloseDate, deal.stage.kind);
            return (
              <tr
                key={deal.id}
                tabIndex={0}
                onClick={() => onOpenDeal(deal)}
                onKeyDown={(event) => handleRowKeyDown(event, deal, onOpenDeal)}
                aria-label={`Open deal ${deal.title}`}
                className={cn(
                  "cursor-pointer border-b border-border/70 transition-colors last:border-b-0",
                  "hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                )}
              >
                <td className="max-w-[240px] px-4 py-3">
                  <p className="truncate font-medium text-fg">{deal.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {deal.contact
                      ? `${deal.contact.firstName} ${deal.contact.lastName}`
                      : "No contact"}
                  </p>
                </td>
                <td className="max-w-[180px] px-4 py-3">
                  <p className="truncate text-muted">
                    {deal.company?.name ?? "—"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={stageKindTone(deal.stage.kind)}>
                    {deal.stage.name}
                  </Badge>
                </td>
                <td className="num whitespace-nowrap px-4 py-3 text-right font-medium text-fg">
                  {formatMoney(deal.value, deal.currency)}
                </td>
                <td className="px-4 py-3">
                  <span
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="inline-flex"
                  >
                    <MomentumMeter momentum={deal.momentum} showBand />
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    aria-label={
                      deal.expectedCloseDate
                        ? `Close date ${formatDate(deal.expectedCloseDate)}${overdue ? ", overdue" : ""}`
                        : "No close date"
                    }
                    className={cn(
                      "inline-flex items-center gap-1 whitespace-nowrap text-xs",
                      overdue ? "font-medium text-danger" : "text-muted",
                    )}
                  >
                    <CalendarDays className="size-3" aria-hidden="true" />
                    {deal.expectedCloseDate
                      ? formatDate(deal.expectedCloseDate, "MMM d, yyyy")
                      : "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
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
                    <span className="max-w-[120px] truncate text-xs text-muted">
                      {deal.owner?.name ?? "Unassigned"}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const skeletonWidths: ReactNode[] = [
  <Skeleton key="deal" className="h-4 w-40" />,
  <Skeleton key="company" className="h-4 w-24" />,
  <Skeleton key="stage" className="h-4 w-20" />,
  <Skeleton key="value" className="ml-auto h-4 w-20" />,
  <Skeleton key="momentum" className="h-4 w-24" />,
  <Skeleton key="close" className="h-4 w-24" />,
  <Skeleton key="owner" className="h-6 w-28" />,
];

export function DealTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      <div className="flex items-center gap-6 border-b border-border bg-white/[0.02] px-4 py-3">
        {skeletonWidths.map((_, index) => (
          <div key={index} className="flex-1">
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-border/70 px-4 py-3.5 last:border-b-0"
        >
          {skeletonWidths.map((cell, index) => (
            <div key={index} className="flex-1">
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
