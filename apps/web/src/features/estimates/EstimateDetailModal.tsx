import { api, type Estimate } from "@meridian/api-client";
import { atLeast } from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Pencil,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, formatMoney } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { EstimateStatusBadge, money, useMembers } from "../operations/shared";

interface EstimateDetailModalProps {
  estimateId: string;
  onClose: () => void;
  onEdit: (estimate: Estimate) => void;
  onDeleted: () => void;
}

export function EstimateDetailModal({
  estimateId,
  onClose,
  onEdit,
  onDeleted,
}: EstimateDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspace, role } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const members = useMembers().data ?? [];
  const [converting, setConverting] = useState(false);
  const [scheduledStart, setScheduledStart] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const estimateQuery = useQuery({
    queryKey: queryKeys.estimates.detail(estimateId),
    queryFn: () => api.estimates.get(estimateId),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
    void queryClient.invalidateQueries({ queryKey: ["ops"] });
    void queryClient.invalidateQueries({ queryKey: ["insights"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
  }

  const setStatus = useMutation({
    mutationFn: (status: Estimate["status"]) => api.estimates.setStatus(estimateId, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.estimates.detail(estimateId), updated);
      invalidate();
      toast.success("Estimate updated");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const convert = useMutation({
    mutationFn: () =>
      api.estimates.convert(estimateId, {
        scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        assigneeId: assigneeId || null,
      }),
    onSuccess: (job) => {
      invalidate();
      toast.success(`Converted to ${job.number}`);
      onClose();
      navigate(`/app/schedule?job=${encodeURIComponent(job.id)}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.estimates.delete(estimateId),
    onSuccess: () => {
      invalidate();
      toast.success("Estimate deleted");
      onDeleted();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const estimate = estimateQuery.data;
  const canConvert =
    estimate &&
    !estimate.jobId &&
    (estimate.status === "SENT" || estimate.status === "APPROVED");

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={estimate ? `${estimate.number} · ${estimate.title}` : "Estimate"}
      description={
        estimate ? `${estimate.customer.name} · ${estimate.location.label}` : "Estimate details"
      }
    >
      {estimateQuery.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading estimate">
          <Skeleton className="h-16" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : estimateQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-danger">Could not load this estimate.</p>
          <p className="mt-1 text-sm text-muted">{apiErrorMessage(estimateQuery.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-4"
            onClick={() => void estimateQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : estimate ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <EstimateStatusBadge status={estimate.status} />
              {estimate.jobId ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <FileText className="size-3.5" aria-hidden="true" />
                  Job {estimate.jobNumber}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onEdit(estimate)}>
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
              <p className="text-sm font-medium text-fg">Delete this estimate?</p>
              <p className="mt-1 text-xs text-muted">This cannot be undone.</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Delete estimate
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
              <dd className="mt-1 truncate text-sm text-fg">{estimate.customer.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Location</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {estimate.location.line1}, {estimate.location.city}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Issued</dt>
              <dd className="mt-1 text-sm text-fg">
                {estimate.issuedAt ? formatDate(estimate.issuedAt) : "Not sent"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Expires</dt>
              <dd className="mt-1 text-sm text-fg">
                {estimate.expiresAt ? formatDate(estimate.expiresAt) : "No expiry"}
              </dd>
            </div>
          </dl>

          <section aria-labelledby="estimate-lines-heading">
            <h3 id="estimate-lines-heading" className="label-micro mb-2">
              Scope
            </h3>
            {estimate.lineItems.length === 0 ? (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted">
                No line items yet. Edit the estimate to add services.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border text-sm">
                {estimate.lineItems.map((line) => (
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
                <dd className="num mt-1 text-fg">{money(estimate.subtotal, currency)}</dd>
              </div>
              <div>
                <dt className="label-micro">Tax ({estimate.taxRate.toFixed(2)}%)</dt>
                <dd className="num mt-1 text-fg">{money(estimate.tax, currency)}</dd>
              </div>
              <div>
                <dt className="label-micro">Total</dt>
                <dd className="num mt-1 text-base text-fg">
                  {money(estimate.total, currency)}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="estimate-actions-heading">
            <h3 id="estimate-actions-heading" className="label-micro mb-2">
              Quote actions
            </h3>
            <div className="flex flex-wrap gap-2">
              {estimate.status === "DRAFT" ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate("SENT")}
                >
                  <Send className="size-4" aria-hidden="true" />
                  Mark sent
                </Button>
              ) : null}
              {estimate.status !== "APPROVED" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate("APPROVED")}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Approve
                </Button>
              ) : null}
              {estimate.status !== "DECLINED" && estimate.status !== "APPROVED" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={setStatus.isPending}
                  onClick={() => setStatus.mutate("DECLINED")}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Decline
                </Button>
              ) : null}
              {canConvert ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setConverting((current) => !current)}
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                  Convert to job
                </Button>
              ) : null}
            </div>

            {converting && canConvert ? (
              <div className="mt-3 rounded-card border border-border bg-surface-2/40 p-4">
                <p className="text-sm font-medium text-fg">Schedule the converted job</p>
                <p className="mt-1 text-xs text-muted">
                  Optional — the job can also be scheduled later.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium text-muted">
                    Start
                    <input
                      type="datetime-local"
                      value={scheduledStart}
                      onChange={(event) => setScheduledStart(event.target.value)}
                      className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-muted">
                    Assignee
                    <Select
                      value={assigneeId}
                      onChange={(event) => setAssigneeId(event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.user.id}>
                          {member.user.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={convert.isPending}
                    onClick={() => convert.mutate()}
                  >
                    Create job
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={convert.isPending}
                    onClick={() => setConverting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {estimate.jobId ? (
              <p className="mt-3 text-xs text-muted">
                Already on job {estimate.jobNumber ?? estimate.jobId}.{" "}
                <button
                  type="button"
                  className="font-medium text-accent hover:text-accent/80"
                  onClick={() => {
                    onClose();
                    navigate(`/app/schedule?job=${encodeURIComponent(estimate.jobId ?? "")}`);
                  }}
                >
                  Open job
                </button>
              </p>
            ) : null}
          </section>

          {estimate.notes ? (
            <section>
              <h3 className="label-micro mb-2">Notes</h3>
              <p className="whitespace-pre-wrap rounded-card border border-border bg-surface-2/40 p-4 text-sm leading-relaxed text-muted">
                {estimate.notes}
              </p>
            </section>
          ) : null}

          <p className="text-xs text-muted">
            Total value {formatMoney(estimate.total, currency)} · updated{" "}
            {formatDate(estimate.updatedAt)}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
