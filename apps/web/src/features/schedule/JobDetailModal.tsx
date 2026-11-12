import { api, type Job } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  MapPin,
  PauseCircle,
  Pencil,
  PlayCircle,
  Receipt,
  RotateCcw,
  UserRound,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, formatDateTime, formatMoney } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import {
  EstimateStatusBadge,
  InvoiceStatusBadge,
  JobStatusBadge,
  customerTypeLabel,
  money,
} from "../operations/shared";
import { RECURRENCE_LABEL } from "@meridian/contracts";

interface JobDetailModalProps {
  jobId: string;
  onClose: () => void;
  onEdit: (job: Job) => void;
  onDuplicated: (job: Job) => void;
}

export function JobDetailModal({
  jobId,
  onClose,
  onEdit,
  onDuplicated,
}: JobDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [canceling, setCanceling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);

  const INVOICE_PAGE_SIZE = 8;

  const jobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: () => api.jobs.get(jobId),
    retry: false,
  });

  const estimatesQuery = useQuery({
    queryKey: queryKeys.estimates.list({ customerId: jobQuery.data?.customer.id, pageSize: 50 }),
    queryFn: () => api.estimates.list({ customerId: jobQuery.data?.customer.id, pageSize: 50 }),
    enabled: Boolean(jobQuery.data?.customer.id),
  });

  const invoiceListQuery = {
    jobId,
    page: invoicePage,
    pageSize: INVOICE_PAGE_SIZE,
  };

  const invoicesQuery = useQuery({
    queryKey: queryKeys.invoices.list(invoiceListQuery),
    queryFn: () => api.invoices.list(invoiceListQuery),
  });

  function invalidate(job: Job) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(job.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    void queryClient.invalidateQueries({ queryKey: ["ops"] });
    void queryClient.invalidateQueries({ queryKey: ["insights"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }

  const setStatus = useMutation({
    mutationFn: (input: { status: Job["status"]; reason?: string }) =>
      api.jobs.setStatus(jobId, input.status, input.reason),
    onSuccess: (job) => {
      invalidate(job);
      setCanceling(false);
      setCancelReason("");
      toast.success("Job status updated");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const duplicate = useMutation({
    mutationFn: () => api.jobs.duplicate(jobId, null),
    onSuccess: (job) => {
      invalidate(job);
      toast.success(`Copied to ${job.number}`);
      onDuplicated(job);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const job = jobQuery.data;
  const openInvoices = (invoicesQuery.data?.data ?? []).filter(
    (invoice) => invoice.status !== "VOID",
  );
  const linkedEstimates = (estimatesQuery.data?.data ?? []).filter(
    (estimate) => estimate.jobId === job?.id,
  );
  const invoiceTotal = invoicesQuery.data?.meta.total ?? 0;
  const invoiceTotalPages = invoicesQuery.data?.meta.totalPages ?? 1;
  const invoicePageSize = invoicesQuery.data?.meta.pageSize ?? INVOICE_PAGE_SIZE;
  const invoiceCurrentPage = invoicesQuery.data?.meta.page ?? invoicePage;
  const invoiceRangeStart = invoiceTotal === 0 ? 0 : (invoiceCurrentPage - 1) * invoicePageSize + 1;
  const invoiceRangeEnd = Math.min(invoiceCurrentPage * invoicePageSize, invoiceTotal);

  useEffect(() => {
    setInvoicePage(1);
  }, [jobId]);

  useEffect(() => {
    if (invoicePage > invoiceTotalPages) setInvoicePage(invoiceTotalPages);
  }, [invoicePage, invoiceTotalPages]);

  function createInvoice() {
    if (!job) return;
    onClose();
    navigate(`/app/invoices?new=1&jobId=${encodeURIComponent(job.id)}`);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={job ? `${job.number} · ${job.title}` : "Job"}
      description={
        job
          ? `${job.customer.name} · ${job.location.label}`
          : "Work order details"
      }
    >
      {jobQuery.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading job">
          <Skeleton className="h-16" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : jobQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-danger">Could not load this job.</p>
          <p className="mt-1 text-sm text-muted">{apiErrorMessage(jobQuery.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-4"
            onClick={() => void jobQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : job ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <JobStatusBadge status={job.status} />
              <Badge tone={job.priority === "URGENT" ? "danger" : "neutral"}>
                {job.priority}
              </Badge>
              {job.assignee ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <UserRound className="size-3.5" aria-hidden="true" />
                  {job.assignee.name}
                </span>
              ) : (
                <span className="text-xs text-muted">Unassigned</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onEdit(job)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => duplicate.mutate()}
                loading={duplicate.isPending}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Duplicate
              </Button>
            </div>
          </div>

          <dl className="grid gap-4 rounded-card border border-border bg-surface-2/40 p-4 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <dt className="label-micro">Service location</dt>
              <dd className="mt-1 flex items-start gap-2 text-sm text-fg">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{job.location.label}</span>
                  <span className="block text-muted">
                    {[
                      job.location.line1,
                      job.location.city,
                      job.location.state,
                      job.location.postalCode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Customer</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm text-fg">
                <span className="truncate">{job.customer.name}</span>
                <Badge tone="neutral">{customerTypeLabel(job.customer.customerType)}</Badge>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Customer phone</dt>
              <dd className="mt-1 text-sm text-fg">
                {job.customer.phone ? (
                  <a href={`tel:${job.customer.phone}`} className="text-accent">
                    {job.customer.phone}
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Schedule</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm text-fg">
                <CalendarClock className="size-3.5 text-muted" aria-hidden="true" />
                {job.scheduledStart ? formatDateTime(job.scheduledStart) : "Unscheduled"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Duration</dt>
              <dd className="num mt-1 text-sm text-fg">{job.durationMinutes} min</dd>
            </div>
            {job.recurrence ? (
              <div className="min-w-0">
                <dt className="label-micro">Repeats</dt>
                <dd className="mt-1 text-sm text-fg">{RECURRENCE_LABEL[job.recurrence]}</dd>
              </div>
            ) : null}
            <div className="min-w-0">
              <dt className="label-micro">Source</dt>
              <dd className="mt-1 text-sm text-fg">{job.source ?? "—"}</dd>
            </div>
          </dl>

          <section aria-labelledby="job-status-heading">
            <h3 id="job-status-heading" className="label-micro mb-2">
              Next step
            </h3>
            <div className="flex flex-wrap gap-2">
              {job.status !== "IN_PROGRESS" &&
              job.status !== "COMPLETED" &&
              job.status !== "CANCELED" ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setStatus.mutate({ status: "IN_PROGRESS" })}
                  loading={setStatus.isPending}
                >
                  <PlayCircle className="size-4" aria-hidden="true" />
                  Start job
                </Button>
              ) : null}
              {job.status !== "COMPLETED" && job.status !== "CANCELED" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatus.mutate({ status: "COMPLETED" })}
                  loading={setStatus.isPending}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Mark complete
                </Button>
              ) : null}
              {job.status === "COMPLETED" || job.status === "CANCELED" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatus.mutate({ status: "SCHEDULED" })}
                  loading={setStatus.isPending}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Reopen
                </Button>
              ) : null}
              {job.status === "IN_PROGRESS" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatus.mutate({ status: "SCHEDULED" })}
                  loading={setStatus.isPending}
                >
                  <PauseCircle className="size-4" aria-hidden="true" />
                  Back to scheduled
                </Button>
              ) : null}
              {job.status !== "CANCELED" ? (
                <Button size="sm" variant="danger" onClick={() => setCanceling(true)}>
                  <XCircle className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              ) : null}
              {job.status === "COMPLETED" ? (
                <Button size="sm" variant="secondary" onClick={createInvoice}>
                  <Receipt className="size-4" aria-hidden="true" />
                  Create invoice
                </Button>
              ) : null}
            </div>
            {canceling ? (
              <div className="mt-3 rounded-card border border-danger/30 bg-danger/5 p-4">
                <p className="text-sm font-medium text-fg">Cancel this job?</p>
                <p className="mt-1 text-xs text-muted">
                  Optional reason is appended to the job notes.
                </p>
                <input
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={240}
                  aria-label="Cancellation reason (optional)"
                  placeholder="Customer rescheduled"
                  className="mt-3 h-9 w-full rounded-input border border-border bg-surface px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    loading={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({
                        status: "CANCELED",
                        reason: cancelReason.trim() || undefined,
                      })
                    }
                  >
                    Cancel job
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCanceling(false)}
                    disabled={setStatus.isPending}
                  >
                    Keep job
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="job-lines-heading">
            <h3 id="job-lines-heading" className="label-micro mb-2">
              Scope
            </h3>
            {job.lineItems.length === 0 ? (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted">
                No line items yet. Edit the job to add services.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border text-sm">
                {job.lineItems.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-fg">{line.name}</span>
                      <span className="num text-xs text-muted">
                        {line.quantity} × {money(line.unitPrice, currency)}
                      </span>
                    </span>
                    <span className="num shrink-0 text-fg">{money(line.total, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-3 grid gap-2 rounded-card border border-border bg-surface-2/40 p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="label-micro">Subtotal</dt>
                <dd className="num mt-1 text-fg">{money(job.subtotal, currency)}</dd>
              </div>
              <div>
                <dt className="label-micro">Tax ({job.taxRate.toFixed(2)}%)</dt>
                <dd className="num mt-1 text-fg">{money(job.tax, currency)}</dd>
              </div>
              <div>
                <dt className="label-micro">Total</dt>
                <dd className="num mt-1 text-base text-fg">{money(job.total, currency)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="job-documents-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="job-documents-heading" className="text-sm font-medium text-fg">
                Linked documents
              </h3>
              <Button size="sm" variant="secondary" onClick={createInvoice}>
                <Receipt className="size-3.5" aria-hidden="true" />
                New invoice
              </Button>
            </div>
            {invoicesQuery.isPending ? (
              <Skeleton className="h-12" />
            ) : invoicesQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm">
                <p className="font-medium text-danger">Could not load invoices.</p>
                <p className="mt-1 text-muted">{apiErrorMessage(invoicesQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void invoicesQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : invoiceTotal === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-4 text-sm text-muted">
                No invoices on this job yet.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                  {openInvoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">{invoice.number}</span>
                        <span className="block truncate text-xs text-muted">
                          Issued {formatDate(invoice.issuedAt)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} />
                        <span className="num text-sm text-fg">{formatMoney(invoice.amount, currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="num text-xs text-muted">
                    Showing {invoiceRangeStart}–{invoiceRangeEnd} of {invoiceTotal}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setInvoicePage((current) => Math.max(1, current - 1))}
                      disabled={invoiceCurrentPage <= 1}
                      aria-label="Previous invoice page"
                    >
                      Previous
                    </Button>
                    <span className="num text-xs text-muted">
                      Page {invoiceCurrentPage} of {invoiceTotalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setInvoicePage((current) => Math.min(invoiceTotalPages, current + 1))
                      }
                      disabled={invoiceCurrentPage >= invoiceTotalPages}
                      aria-label="Next invoice page"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
            {estimatesQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm">
                <p className="font-medium text-danger">Could not load estimates.</p>
                <p className="mt-1 text-muted">{apiErrorMessage(estimatesQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void estimatesQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : linkedEstimates.length ? (
              <div className="space-y-2">
                <p className="num text-xs text-muted">
                  Linked estimates · {linkedEstimates.length}
                </p>
                <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                  {linkedEstimates.map((estimate) => (
                    <li key={estimate.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">
                          {estimate.number} · {estimate.title}
                        </span>
                        <span className="block truncate text-xs text-muted">Estimate</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <EstimateStatusBadge status={estimate.status} />
                        <span className="num text-sm text-fg">
                          {formatMoney(estimate.total, currency)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {estimatesQuery.data &&
                estimatesQuery.data.meta.total > linkedEstimates.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="num text-xs text-muted">
                      Showing {linkedEstimates.length} linked of{" "}
                      {estimatesQuery.data.meta.total} customer estimates
                    </p>
                    <Link
                      to="/app/estimates"
                      className="text-xs font-medium text-accent transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      View estimates
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {job.notes ? (
            <section>
              <h3 className="label-micro mb-2">Notes</h3>
              <p className="whitespace-pre-wrap rounded-card border border-border bg-surface-2/40 p-4 text-sm leading-relaxed text-muted">
                {job.notes}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
