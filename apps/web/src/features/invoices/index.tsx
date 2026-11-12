import { api, type Invoice, type InvoiceStatus } from "@meridian/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus, Receipt, Search } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import {
  cn,
  downloadCsv,
  formatDate,
  formatMoney,
  useDebouncedValue,
} from "../../lib/utils";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage } from "../companies/lib";
import { InvoiceStatusBadge } from "../operations/shared";
import { InvoiceDetailModal } from "./InvoiceDetailModal";
import { InvoiceFormModal } from "./InvoiceFormModal";

const PAGE_SIZE = 25;

const STATUS_TABS: { value: InvoiceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PARTIAL", label: "Partial" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];

export default function InvoicesPage() {
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("invoice");
  const creating = params.get("new") === "1";
  const defaultJobId = params.get("jobId") ?? "";
  const [status, setStatus] = useState<InvoiceStatus | "ALL">("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  // Paid invoices can never be overdue: the status wins over the toggle.
  const overdueFilter: "true" | undefined =
    overdueOnly && status !== "PAID" ? "true" : undefined;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, overdueOnly]);

  const listQuery = {
    status: status === "ALL" ? undefined : status,
    overdue: overdueFilter,
    q: debouncedSearch.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
    sort: "dueAt",
    order: "asc" as const,
  };

  const invoicesQuery = useQuery({
    queryKey: queryKeys.invoices.list(listQuery),
    queryFn: () => api.invoices.list(listQuery),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const totalPages = invoicesQuery.data?.meta.totalPages;
    if (totalPages && page > totalPages) setPage(totalPages);
  }, [invoicesQuery.data, page]);

  const invoices = invoicesQuery.data?.data ?? [];
  const total = invoicesQuery.data?.meta.total ?? 0;
  const totalPages = invoicesQuery.data?.meta.totalPages ?? 1;
  const pageSize = invoicesQuery.data?.meta.pageSize ?? PAGE_SIZE;
  const currentPage = invoicesQuery.data?.meta.page ?? page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);
  const hasFilters = Boolean(search.trim()) || status !== "ALL" || overdueOnly;

  function changeStatus(next: InvoiceStatus | "ALL") {
    setStatus(next);
    if (next === "PAID") setOverdueOnly(false);
  }

  function setParam(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  }

  function closeCreate() {
    const next = new URLSearchParams(params);
    next.delete("new");
    next.delete("jobId");
    setParams(next, { replace: true });
  }

  async function exportInvoices() {
    setExporting(true);
    try {
      const blob = await api.exports.invoices({
        status: status === "ALL" ? undefined : status,
        overdue: overdueFilter,
        q: debouncedSearch.trim() || undefined,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(blob, `invoices-${stamp}.csv`);
      toast.success("Invoices exported");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="BILLING"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Invoices
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {invoicesQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="Receivables from completed work — sent, collected and reconciled."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void exportInvoices()}
              loading={exporting}
            >
              {exporting ? null : (
                <Download className="size-4" aria-hidden="true" />
              )}
              Export CSV
            </Button>
            <Button variant="primary" onClick={() => setParam("new", "1")}>
              <Plus className="size-4" aria-hidden="true" />
              New invoice
            </Button>
          </div>
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
              placeholder="Search invoices by number, title or customer"
              aria-label="Search invoices"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={overdueOnly}
              disabled={status === "PAID"}
              title={
                status === "PAID"
                  ? "Paid invoices are never overdue."
                  : "Only show invoices past their due date."
              }
              onClick={() => setOverdueOnly((current) => !current)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-input border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                overdueOnly
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-surface text-muted hover:text-fg",
              )}
            >
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Overdue only
            </button>
            <p aria-live="polite" className="num shrink-0 text-xs text-muted">
              {invoicesQuery.isError
                ? "—"
                : invoicesQuery.data
                  ? `${total} ${total === 1 ? "invoice" : "invoices"}`
                  : "Loading"}
            </p>
          </div>
        </div>
        <Tabs
          ariaLabel="Invoice status"
          items={STATUS_TABS.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          value={status}
          onChange={(value) => changeStatus(value as InvoiceStatus | "ALL")}
          className="border-0"
        />
      </Card>

      {invoicesQuery.isPending ? (
        <ListSkeleton />
      ) : invoicesQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">
              Could not load invoices.
            </p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(invoicesQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void invoicesQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={
            hasFilters ? "No invoices match those filters." : "No invoices yet."
          }
          description={
            hasFilters
              ? "Try another status or clear the overdue filter."
              : "Bill a completed job or create an invoice against a customer."
          }
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setStatus("ALL");
                  setOverdueOnly(false);
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setParam("new", "1")}>
                <Plus className="size-4" aria-hidden="true" />
                New invoice
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-4 py-3">
                      Invoice
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Customer
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Due
                    </th>
                    <th
                      scope="col"
                      className="label-micro px-4 py-3 text-right"
                    >
                      Amount
                    </th>
                    <th
                      scope="col"
                      className="label-micro px-4 py-3 text-right"
                    >
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      tabIndex={0}
                      aria-label={`Open ${invoice.number}`}
                      onClick={() => setParam("invoice", invoice.id)}
                      onKeyDown={(event) =>
                        handleRowKeyDown(event, invoice.id, (id) =>
                          setParam("invoice", id),
                        )
                      }
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <td className="px-4 py-3">
                        <p className="num text-xs text-accent">
                          {invoice.number}
                        </p>
                        <p className="max-w-[260px] truncate font-medium text-fg">
                          {invoice.title}
                        </p>
                        {invoice.jobNumber ? (
                          <p className="num text-[11px] text-muted">
                            Job {invoice.jobNumber}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate text-fg">
                          {invoice.customer.name}
                        </p>
                        <p className="max-w-[180px] truncate text-xs text-muted">
                          {invoice.location?.city ?? "No location"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge
                          status={invoice.status}
                          overdue={invoice.overdue}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {invoice.dueAt ? formatDate(invoice.dueAt) : "—"}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right text-fg">
                        {formatMoney(invoice.amount, currency)}
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right text-fg">
                        {formatMoney(invoice.balance, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                onClick={() => setParam("invoice", invoice.id)}
                className="w-full rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-xs text-accent">{invoice.number}</p>
                    <p className="truncate font-medium text-fg">
                      {invoice.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invoice.customer.name}
                    </p>
                  </div>
                  <InvoiceStatusBadge
                    status={invoice.status}
                    overdue={invoice.overdue}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <span className="text-muted">
                    {invoice.dueAt
                      ? `Due ${formatDate(invoice.dueAt)}`
                      : "No due date"}
                  </span>
                  <span className="num text-fg">
                    {formatMoney(invoice.balance, currency)} due
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
        <InvoiceFormModal
          defaultJobId={defaultJobId}
          onClose={closeCreate}
          onSaved={(invoice) => {
            const next = new URLSearchParams();
            next.set("invoice", invoice.id);
            setParams(next, { replace: true });
          }}
        />
      ) : null}

      {selectedId ? (
        <InvoiceDetailModal
          invoiceId={selectedId}
          onClose={() => setParam("invoice", null)}
          onEdit={(invoice) => setEditing(invoice)}
          onDeleted={() => setParam("invoice", null)}
        />
      ) : null}

      {editing ? (
        <InvoiceFormModal
          invoice={editing}
          onClose={() => setEditing(null)}
          onSaved={(invoice) => {
            setEditing(null);
            setParam("invoice", invoice.id);
          }}
        />
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  id: string,
  open: (invoiceId: string) => void,
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
