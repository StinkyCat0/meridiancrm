import { api, type CreateJobInput, type Job } from "@meridian/api-client";
import {
  JOB_PRIORITIES,
  JOB_PRIORITY_META,
  JOB_STATUSES,
  JOB_STATUS_META,
  RECURRENCE_LABEL,
  RECURRENCE_FREQUENCIES,
  type JobPriority,
  type JobStatus,
  type RecurrenceFrequency,
} from "@meridian/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { formatMoney, toCents } from "../../lib/utils";
import {
  CustomerLocationFields,
  LineItemsEditor,
  TotalsPreview,
  draftFromItems,
  draftSubtotal,
  emptyLine,
  fromDateTimeLocal,
  money,
  toDateTimeLocal,
  toLineInputs,
  useMembers,
  type LineItemDraft,
} from "../operations/shared";
import { useAuth } from "../../lib/auth";
import { apiErrorMessage } from "../companies/lib";

interface JobFormModalProps {
  job?: Job | null;
  defaultCustomerId?: string;
  onClose: () => void;
  onSaved: (job: Job) => void;
}

export function JobFormModal({
  job,
  defaultCustomerId = "",
  onClose,
  onSaved,
}: JobFormModalProps) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const formId = useId();
  const membersQuery = useMembers();
  const members = membersQuery.data ?? [];

  const [title, setTitle] = useState(job?.title ?? "");
  const [customerId, setCustomerId] = useState(
    job?.customer.id ?? defaultCustomerId,
  );
  const [locationId, setLocationId] = useState(job?.location.id ?? "");
  const [assigneeId, setAssigneeId] = useState(job?.assignee?.id ?? "");
  const [status, setStatus] = useState<JobStatus>(job?.status ?? "SCHEDULED");
  const [priority, setPriority] = useState<JobPriority>(
    job?.priority ?? "NORMAL",
  );
  const [scheduledStart, setScheduledStart] = useState(
    toDateTimeLocal(job?.scheduledStart),
  );
  const [durationMinutes, setDurationMinutes] = useState(
    String(job?.durationMinutes ?? 60),
  );
  const [taxRate, setTaxRate] = useState(String(job?.taxRate ?? 0));
  const [deposit, setDeposit] = useState(
    job ? (job.deposit / 100).toFixed(2) : "0.00",
  );
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | "">(
    job?.recurrence ?? "",
  );
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [lines, setLines] = useState<LineItemDraft[]>(
    job ? draftFromItems(job.lineItems) : [emptyLine()],
  );
  const [errors, setErrors] = useState<{ title?: string; location?: string }>(
    {},
  );

  const save = useMutation({
    mutationFn: (input: CreateJobInput) =>
      job ? api.jobs.update(job.id, input) : api.jobs.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      void queryClient.invalidateQueries({ queryKey: ["ops"] });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
      toast.success(job ? "Job updated" : "Job created");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = "Give the job a short title.";
    if (!customerId || !locationId) {
      nextErrors.location = "Choose the customer and the service location.";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    const start = fromDateTimeLocal(scheduledStart);
    const duration = Math.max(5, Number(durationMinutes) || 60);
    const end = start
      ? new Date(new Date(start).getTime() + duration * 60_000).toISOString()
      : null;
    const nextStatus: JobStatus = start ? status : "UNSCHEDULED";

    save.mutate({
      title: title.trim(),
      customerId,
      locationId,
      assigneeId: assigneeId || null,
      status: nextStatus,
      priority,
      scheduledStart: start,
      scheduledEnd: end,
      durationMinutes: duration,
      taxRate: Number(taxRate) || 0,
      deposit: toCents(deposit),
      notes: notes.trim() || null,
      recurrence: recurrence || null,
      lineItems: toLineInputs(lines),
    });
  }

  const id = (field: string) => `${formId}-${field}`;
  const subtotal = draftSubtotal(lines);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={job ? `Edit ${job.number}` : "New job"}
      description="Schedule the work, assign the crew and price the visit."
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
            {job ? "Save job" : "Create job"}
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
        <Field
          label="Job title"
          htmlFor={id("title")}
          required
          error={errors.title}
        >
          <Input
            id={id("title")}
            data-autofocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (errors.title)
                setErrors((current) => ({ ...current, title: undefined }));
            }}
            invalid={Boolean(errors.title)}
            maxLength={160}
            placeholder="Quarterly window clean — lobby"
          />
        </Field>

        <CustomerLocationFields
          customerId={customerId}
          locationId={locationId}
          onChange={(next) => {
            setCustomerId(next.customerId);
            setLocationId(next.locationId);
            if (errors.location)
              setErrors((current) => ({ ...current, location: undefined }));
          }}
        />
        {errors.location ? (
          <p role="alert" className="text-xs text-danger">
            {errors.location}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignee" htmlFor={id("assignee")}>
            <Select
              id={id("assignee")}
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
          </Field>
          <Field label="Priority" htmlFor={id("priority")}>
            <Select
              id={id("priority")}
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as JobPriority)
              }
            >
              {JOB_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {JOB_PRIORITY_META[value].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Start"
            htmlFor={id("start")}
            hint="Leave empty to keep the job unscheduled."
          >
            <Input
              id={id("start")}
              type="datetime-local"
              value={scheduledStart}
              onChange={(event) => {
                setScheduledStart(event.target.value);
                if (event.target.value && status === "UNSCHEDULED")
                  setStatus("SCHEDULED");
              }}
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor={id("duration")}>
            <Input
              id={id("duration")}
              type="number"
              min="5"
              max="1440"
              step="5"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status" htmlFor={id("status")}>
            <Select
              id={id("status")}
              value={scheduledStart ? status : "UNSCHEDULED"}
              disabled={!scheduledStart}
              onChange={(event) => setStatus(event.target.value as JobStatus)}
            >
              {JOB_STATUSES.filter((value) => value !== "UNSCHEDULED").map(
                (value) => (
                  <option key={value} value={value}>
                    {JOB_STATUS_META[value].label}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Tax rate (%)" htmlFor={id("tax")}>
            <Input
              id={id("tax")}
              type="number"
              min="0"
              max="50"
              step="0.01"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
            />
          </Field>
          <Field label={`Deposit (${currency})`} htmlFor={id("deposit")}>
            <Input
              id={id("deposit")}
              inputMode="decimal"
              value={deposit}
              onChange={(event) => setDeposit(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repeats" htmlFor={id("recurrence")}>
            <Select
              id={id("recurrence")}
              value={recurrence}
              onChange={(event) =>
                setRecurrence(event.target.value as RecurrenceFrequency | "")
              }
            >
              <option value="">One-off visit</option>
              {RECURRENCE_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {RECURRENCE_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deposit vs. estimate" htmlFor={id("balance")}>
            <div
              id={id("balance")}
              className="flex h-10 items-center rounded-input border border-border bg-surface-2/40 px-3 text-sm text-muted"
            >
              <span className="num mr-1 text-fg">
                {money(subtotal, currency)}
              </span>
              <span>subtotal before tax</span>
            </div>
          </Field>
        </div>

        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          currency={currency}
        />
        <TotalsPreview lines={lines} taxRate={taxRate} currency={currency} />

        <Field label="Notes" htmlFor={id("notes")}>
          <Textarea
            id={id("notes")}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="Gate codes, on-site contact, scope notes…"
          />
        </Field>

        {job ? (
          <p className="text-xs text-muted">
            Current total {formatMoney(job.total, currency)} · line items are
            re-priced on save.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
