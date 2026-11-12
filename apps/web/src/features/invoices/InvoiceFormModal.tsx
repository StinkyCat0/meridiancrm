import {
  api,
  type CreateInvoiceInput,
  type Invoice,
  type Job,
} from "@meridian/api-client";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_META,
  type InvoiceStatus,
} from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatMoney, toCents } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { fromDateInput, toDateInput, useCustomers } from "../operations/shared";

interface InvoiceFormModalProps {
  invoice?: Invoice | null;
  defaultJobId?: string;
  onClose: () => void;
  onSaved: (invoice: Invoice) => void;
}

export function InvoiceFormModal({
  invoice,
  defaultJobId = "",
  onClose,
  onSaved,
}: InvoiceFormModalProps) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const formId = useId();
  const customersQuery = useCustomers();
  const customers = customersQuery.data?.data ?? [];

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({
      scope: "all",
      pageSize: 100,
      sort: "scheduledStart",
      order: "desc",
    }),
    queryFn: () =>
      api.jobs.list({
        scope: "all",
        pageSize: 100,
        sort: "scheduledStart",
        order: "desc",
      }),
    enabled: !invoice,
  });

  const defaultJobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(defaultJobId),
    queryFn: () => api.jobs.get(defaultJobId),
    enabled: Boolean(defaultJobId) && !invoice,
  });

  const [mode, setMode] = useState<"job" | "customer">(
    defaultJobId ? "job" : "job",
  );
  const [jobId, setJobId] = useState(defaultJobId);
  const [customerId, setCustomerId] = useState(invoice?.customer.id ?? "");
  const [title, setTitle] = useState(invoice?.title ?? "");
  const [amount, setAmount] = useState(
    invoice ? (invoice.amount / 100).toFixed(2) : "",
  );
  const [status, setStatus] = useState<InvoiceStatus>(
    invoice?.status ?? "SENT",
  );
  const [issuedAt, setIssuedAt] = useState(toDateInput(invoice?.issuedAt));
  const [dueAt, setDueAt] = useState(toDateInput(invoice?.dueAt));
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [errors, setErrors] = useState<{ title?: string; target?: string }>({});

  const jobs = jobsQuery.data?.data ?? [];
  const defaultJob = defaultJobQuery.data;

  useEffect(() => {
    if (!defaultJob || invoice) return;
    setJobId(defaultJob.id);
    setTitle(defaultJob.title);
    setAmount((defaultJob.total / 100).toFixed(2));
    setCustomerId(defaultJob.customer.id);
  }, [defaultJob, invoice]);

  function applyJob(job: Job) {
    setJobId(job.id);
    setCustomerId(job.customer.id);
    setTitle(job.title);
    setAmount((job.total / 100).toFixed(2));
  }

  const save = useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      invoice
        ? api.invoices.update(invoice.id, input)
        : api.invoices.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: ["ops"] });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(invoice ? "Invoice updated" : "Invoice created");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = "Give the invoice a short title.";
    if (!invoice) {
      if (mode === "job" && !jobId)
        nextErrors.target = "Choose the job this invoice bills.";
      if (mode === "customer" && !customerId) {
        nextErrors.target = "Choose the customer this invoice bills.";
      }
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    save.mutate({
      title: title.trim(),
      ...(invoice ? {} : mode === "job" ? { jobId } : { customerId }),
      status,
      amount: toCents(amount),
      issuedAt: fromDateInput(issuedAt),
      dueAt: fromDateInput(dueAt),
      notes: notes.trim() || null,
    });
  }

  const selectedJob = jobs.find((job) => job.id === jobId) ?? defaultJob;
  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={invoice ? `Edit ${invoice.number}` : "New invoice"}
      description="Bill the visit and keep receivables in view."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={save.isPending}
          >
            {invoice ? "Save invoice" : "Create invoice"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5"
      >
        {!invoice ? (
          <div
            role="group"
            aria-label="Invoice source"
            className="inline-flex rounded-input border border-border bg-surface p-0.5"
          >
            {(["job", "customer"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setErrors({});
                }}
                className={
                  mode === value
                    ? "h-8 rounded-[8px] bg-white/[0.07] px-3 text-xs font-medium text-fg"
                    : "h-8 rounded-[8px] px-3 text-xs font-medium text-muted hover:bg-white/[0.04] hover:text-fg"
                }
              >
                {value === "job" ? "From a job" : "Customer account"}
              </button>
            ))}
          </div>
        ) : null}

        {!invoice && mode === "job" ? (
          <Field
            label="Job"
            htmlFor={id("job")}
            required
            error={errors.target}
            hint={
              selectedJob
                ? `${formatMoney(selectedJob.total, currency)} total · ${selectedJob.location.label}`
                : "Pick a completed or in-progress visit."
            }
          >
            <Select
              id={id("job")}
              value={jobId}
              onChange={(event) => {
                const job = jobs.find((item) => item.id === event.target.value);
                if (job) applyJob(job);
                else {
                  setJobId(event.target.value);
                  setTitle("");
                  setAmount("");
                }
                setErrors((current) => ({ ...current, target: undefined }));
              }}
            >
              <option value="">
                {jobsQuery.isPending ? "Loading jobs…" : "Select a job"}
              </option>
              {selectedJob && !jobs.some((job) => job.id === selectedJob.id) ? (
                <option value={selectedJob.id}>
                  {selectedJob.number} · {selectedJob.title}
                </option>
              ) : null}
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} · {job.title} ·{" "}
                  {formatMoney(job.total, currency)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!invoice && mode === "customer" ? (
          <Field
            label="Customer"
            htmlFor={id("customer")}
            required
            error={errors.target}
            hint="Location is inherited from the customer's primary site."
          >
            <Select
              id={id("customer")}
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                setErrors((current) => ({ ...current, target: undefined }));
              }}
            >
              <option value="">
                {customersQuery.isPending
                  ? "Loading customers…"
                  : "Select a customer"}
              </option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field
          label="Invoice title"
          htmlFor={id("title")}
          required
          error={errors.title}
        >
          <Input
            id={id("title")}
            data-autofocus={invoice ? true : undefined}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (errors.title)
                setErrors((current) => ({ ...current, title: undefined }));
            }}
            invalid={Boolean(errors.title)}
            maxLength={160}
            placeholder="Exterior window clean — July"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Amount (${currency})`} htmlFor={id("amount")} required>
            <Input
              id={id("amount")}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Status" htmlFor={id("status")}>
            <Select
              id={id("status")}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as InvoiceStatus)
              }
            >
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {INVOICE_STATUS_META[value].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor={id("due")}>
            <Input
              id={id("due")}
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Issued"
          htmlFor={id("issued")}
          hint="Defaults to now when sent."
        >
          <Input
            id={id("issued")}
            type="date"
            value={issuedAt}
            onChange={(event) => setIssuedAt(event.target.value)}
          />
        </Field>

        <Field label="Notes" htmlFor={id("notes")}>
          <Textarea
            id={id("notes")}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Payment terms, PO number, thank-you note…"
          />
        </Field>

        {invoice ? (
          <p className="text-xs text-muted">
            Paid to date {formatMoney(invoice.amountPaid, currency)} · balance{" "}
            {formatMoney(invoice.balance, currency)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
