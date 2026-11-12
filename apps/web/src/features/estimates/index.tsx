import { api, type Estimate, type EstimateStatus } from "@meridian/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Plus, Search } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, formatMoney, useDebouncedValue } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { EstimateStatusBadge } from "../operations/shared";
import { EstimateDetailModal } from "./EstimateDetailModal";
import { EstimateFormModal } from "./EstimateFormModal";

const PAGE_SIZE = 25;

const STATUS_TABS: { value: EstimateStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
];

export default function EstimatesPage() {
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("estimate");
  const creating = params.get("new") === "1";
  const [status, setStatus] = useState<EstimateStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Estimate | null>(null);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const listQuery = {
    status: status === "ALL" ? undefined : status,
    q: debouncedSearch.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
    sort: "updatedAt",
    order: "desc" as const,
  };

  const estimatesQuery = useQuery({
    queryKey: queryKeys.estimates.list(listQuery),
    queryFn: () => api.estimates.list(listQuery),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const totalPages = estimatesQuery.data?.meta.totalPages;
    if (totalPages && page > totalPages) setPage(totalPages);
  }, [estimatesQuery.data, page]);

  const estimates = estimatesQuery.data?.data ?? [];
  const total = estimatesQuery.data?.meta.total ?? 0;
  const totalPages = estimatesQuery.data?.meta.totalPages ?? 1;
  const pageSize = estimatesQuery.data?.meta.pageSize ?? PAGE_SIZE;
  const currentPage = estimatesQuery.data?.meta.page ?? page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);
  const hasFilters = Boolean(search.trim()) || status !== "ALL";

  function setParam(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  }

  function openEstimate(id: string) {
    setParam("estimate", id);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="SALES"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Estimates
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {estimatesQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="Quotes that turn walkthroughs into booked work — priced, sent and approved."
        actions={
          <Button variant="primary" onClick={() => setParam("new", "1")}>
            <Plus className="size-4" aria-hidden="true" />
            New estimate
          </Button>
        }
      />

      <Card className="space-y-3 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search estimates by number, title or customer"
              aria-label="Search estimates"
              className="pl-9"
            />
          </div>
          <p aria-live="polite" className="num shrink-0 text-xs text-muted">
            {estimatesQuery.isError
              ? "—"
              : estimatesQuery.data
                ? `${total} ${total === 1 ? "estimate" : "estimates"}`
                : "Loading"}
          </p>
        </div>
        <Tabs
          ariaLabel="Estimate status"
          items={STATUS_TABS.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          value={status}
          onChange={(value) => setStatus(value as EstimateStatus | "ALL")}
          className="border-0"
        />
      </Card>

      {estimatesQuery.isPending ? (
        <ListSkeleton />
      ) : estimatesQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">
              Could not load estimates.
            </p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(estimatesQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void estimatesQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : estimates.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={
            hasFilters
              ? "No estimates match those filters."
              : "No estimates yet."
          }
          description={
            hasFilters
              ? "Try another status or search for a different customer."
              : "Price your first walkthrough and send it to the customer."
          }
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setStatus("ALL");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setParam("new", "1")}>
                <Plus className="size-4" aria-hidden="true" />
                New estimate
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-4 py-3">
                      Estimate
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Customer
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Issued
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Expires
                    </th>
                    <th
                      scope="col"
                      className="label-micro px-4 py-3 text-right"
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((estimate) => (
                    <tr
                      key={estimate.id}
                      tabIndex={0}
                      aria-label={`Open ${estimate.number}`}
                      onClick={() => openEstimate(estimate.id)}
                      onKeyDown={(event) =>
                        handleRowKeyDown(event, estimate.id, openEstimate)
                      }
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <td className="px-4 py-3">
                        <p className="num text-xs text-accent">
                          {estimate.number}
                        </p>
                        <p className="max-w-[260px] truncate font-medium text-fg">
                          {estimate.title}
                        </p>
                        {estimate.jobNumber ? (
                          <p className="num text-[11px] text-muted">
                            Job {estimate.jobNumber}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate text-fg">
                          {estimate.customer.name}
                        </p>
                        <p className="max-w-[180px] truncate text-xs text-muted">
                          {estimate.location.label} · {estimate.location.city}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <EstimateStatusBadge status={estimate.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {estimate.issuedAt
                          ? formatDate(estimate.issuedAt)
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {estimate.expiresAt
                          ? formatDate(estimate.expiresAt)
                          : "—"}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right text-fg">
                        {formatMoney(estimate.total, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {estimates.map((estimate) => (
              <button
                key={estimate.id}
                type="button"
                onClick={() => openEstimate(estimate.id)}
                className="w-full rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-xs text-accent">{estimate.number}</p>
                    <p className="truncate font-medium text-fg">
                      {estimate.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {estimate.customer.name}
                    </p>
                  </div>
                  <EstimateStatusBadge status={estimate.status} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <span className="truncate text-muted">
                    {estimate.expiresAt
                      ? `Expires ${formatDate(estimate.expiresAt)}`
                      : "No expiry"}
                  </span>
                  <span className="num shrink-0 text-fg">
                    {formatMoney(estimate.total, currency)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="num text-xs text-muted">
              Showing {rangeStart}–{rangeEnd} of {total}
            </p>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="num text-xs text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={currentPage >= totalPages}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {creating ? (
        <EstimateFormModal
          onClose={() => setParam("new", null)}
          onSaved={(estimate) => {
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.delete("new");
                next.set("estimate", estimate.id);
                return next;
              },
              { replace: true },
            );
          }}
        />
      ) : null}

      {selectedId ? (
        <EstimateDetailModal
          estimateId={selectedId}
          onClose={() => setParam("estimate", null)}
          onEdit={(estimate) => setEditing(estimate)}
          onDeleted={() => setParam("estimate", null)}
        />
      ) : null}

      {editing ? (
        <EstimateFormModal
          estimate={editing}
          onClose={() => setEditing(null)}
          onSaved={(estimate) => {
            setEditing(null);
            openEstimate(estimate.id);
          }}
        />
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  id: string,
  open: (estimateId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function ListSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="hidden h-3 w-32 lg:block" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="rounded-card border border-border bg-surface p-4"
          >
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </>
  );
}
