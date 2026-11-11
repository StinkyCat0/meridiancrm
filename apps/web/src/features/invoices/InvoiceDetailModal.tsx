import { api, type Invoice } from "@meridian/api-client";
import { atLeast } from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Pencil,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, formatMoney, toCents } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { InvoiceStatusBadge, money } from "../operations/shared";

interface InvoiceDetailModalProps {
  invoiceId: string;
  onClose: () => void;
  onEdit: (invoice: Invoice) => void;
  onDeleted: () => void;
}

export function InvoiceDetailModal({
  invoiceId,
  onClose,
  onEdit,
  onDeleted,
}: InvoiceDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspace, role } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [payment, setPayment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invoiceQuery = useQuery({
    queryKey: queryKeys.invoices.detail(invoiceId),
    queryFn: () => api.invoices.get(invoiceId),
    retry: false,
  });

  const invoice = invoiceQuery.data;

  function invalidate(updated?: Invoice) {
    if (updated) queryClient.setQueryData(queryKeys.invoices.detail(invoiceId), updated);
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    void queryClient.invalidateQueries({ queryKey: ["ops"] });
    void queryClient.invalidateQueries({ queryKey: ["insights"] });
  }

  const update = useMutation({
    mutationFn: (input: { status?: Invoice["status"]; amountPaid?: number }) =>
      api.invoices.update(invoiceId, input),
    onSuccess: (updated) => {
      invalidate(updated);
      toast.success("Invoice updated");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const recordPayment = useMutation({
    mutationFn: (amountPaid: number) => api.invoices.recordPayment(invoiceId, amountPaid),
    onSuccess: (updated) => {
      invalidate(updated);
      setPayment("");
      toast.success("Payment recorded");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.invoices.delete(invoiceId),
    onSuccess: () => {
      invalidate();
      toast.success("Invoice deleted");
      onDeleted();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function submitPayment() {
    if (!invoice) return;
    const current = invoice.amountPaid;
    const delta = toCents(payment);
    if (delta <= 0) {
      toast.error("Enter a payment amount greater than zero.");
      return;
    }
    recordPayment.mutate(Math.min(invoice.amount, current + delta));
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={invoice ? `${invoice.number} · ${invoice.title}` : "Invoice"}
      description={invoice ? invoice.customer.name : "Invoice details"}
    >
      {invoiceQuery.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading invoice">
          <Skeleton className="h-16" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : invoiceQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-danger">Could not load this invoice.</p>
          <p className="mt-1 text-sm text-muted">{apiErrorMessage(invoiceQuery.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-4"
            onClick={() => void invoiceQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : invoice ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} />
              {invoice.jobNumber ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  Job {invoice.jobNumber}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onEdit(invoice)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
              {atLeast(role ?? "MEMBER", "ADMIN") ? (
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>

          {confirmDelete ? (
            <div className="rounded-card border border-danger/30 bg-danger/5 p-4">
              <p className="text-sm font-medium text-fg">Delete this invoice?</p>
              <p className="mt-1 text-xs text-muted">
                Payments and history for this invoice are removed. Void it instead to keep a
                record.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Delete invoice
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}

          <dl className="grid gap-4 rounded-card border border-border bg-surface-2/40 p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="label-micro">Customer</dt>
              <dd className="mt-1 truncate text-sm text-fg">{invoice.customer.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Service location</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {invoice.location
                  ? `${invoice.location.label} · ${invoice.location.city}`
                  : "—"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Issued</dt>
              <dd className="mt-1 text-sm text-fg">
                {invoice.issuedAt ? formatDate(invoice.issuedAt) : "Not sent"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Due</dt>
              <dd className="mt-1 text-sm text-fg">
                {invoice.dueAt ? formatDate(invoice.dueAt) : "No due date"}
              </dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-card border border-border bg-surface-2/40 p-4">
              <p className="label-micro">Amount</p>
              <p className="num mt-1 text-lg text-fg">{money(invoice.amount, currency)}</p>
            </div>
            <div className="rounded-card border border-border bg-surface-2/40 p-4">
              <p className="label-micro">Paid</p>
              <p className="num mt-1 text-lg text-success">
                {money(invoice.amountPaid, currency)}
              </p>
            </div>
            <div className="rounded-card border border-border bg-surface-2/40 p-4">
              <p className="label-micro">Balance</p>
              <p className="num mt-1 text-lg text-fg">{money(invoice.balance, currency)}</p>
            </div>
          </div>

          <section aria-labelledby="invoice-actions-heading" className="space-y-3">
            <h3 id="invoice-actions-heading" className="label-micro">
              Collect payment
            </h3>
            {invoice.status !== "VOID" ? (
              <div className="rounded-card border border-border bg-surface-2/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 space-y-1.5 text-xs font-medium text-muted">
                    Payment amount ({currency})
                    <Input
                      inputMode="decimal"
                      value={payment}
                      onChange={(event) => setPayment(event.target.value)}
                      placeholder={((invoice.balance || 0) / 100).toFixed(2)}
                    />
                  </label>
                  <Button
                    variant="primary"
                    loading={recordPayment.isPending}
                    onClick={submitPayment}
                  >
                    <Wallet className="size-4" aria-hidden="true" />
                    Record payment
                  </Button>
                  {invoice.balance > 0 ? (
                    <Button
                      variant="secondary"
                      loading={update.isPending}
                      onClick={() => update.mutate({ status: "PAID" })}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Mark paid
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Payments are tracked against the total paid to date.
                </p>
              </div>
            ) : (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted">
                Void invoices cannot take payments.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {invoice.status === "DRAFT" ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={update.isPending}
                  onClick={() => update.mutate({ status: "SENT" })}
                >
                  <Send className="size-4" aria-hidden="true" />
                  Send invoice
                </Button>
              ) : null}
              {invoice.status !== "VOID" && invoice.status !== "PAID" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => update.mutate({ status: "VOID" })}
                >
                  <Ban className="size-4" aria-hidden="true" />
                  Void
                </Button>
              ) : null}
              {invoice.jobId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    navigate(`/app/schedule?job=${encodeURIComponent(invoice.jobId ?? "")}`);
                  }}
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                  Open job
                </Button>
              ) : null}
            </div>
          </section>

          {invoice.notes ? (
            <section>
              <h3 className="label-micro mb-2">Notes</h3>
              <p className="whitespace-pre-wrap rounded-card border border-border bg-surface-2/40 p-4 text-sm leading-relaxed text-muted">
                {invoice.notes}
              </p>
            </section>
          ) : null}

          <p className="text-xs text-muted">
            Created {formatDate(invoice.createdAt)}
            {invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ""} ·{" "}
            {formatMoney(invoice.amount, currency)}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
