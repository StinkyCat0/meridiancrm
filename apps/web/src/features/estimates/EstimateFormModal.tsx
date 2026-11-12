import {
  api,
  type CreateEstimateInput,
  type Estimate,
} from "@meridian/api-client";
import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_META,
  type EstimateStatus,
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
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage } from "../companies/lib";
import {
  CustomerLocationFields,
  LineItemsEditor,
  TotalsPreview,
  draftFromItems,
  emptyLine,
  fromDateInput,
  toDateInput,
  toLineInputs,
  type LineItemDraft,
} from "../operations/shared";

interface EstimateFormModalProps {
  estimate?: Estimate | null;
  onClose: () => void;
  onSaved: (estimate: Estimate) => void;
}

export function EstimateFormModal({
  estimate,
  onClose,
  onSaved,
}: EstimateFormModalProps) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const formId = useId();

  const [title, setTitle] = useState(estimate?.title ?? "");
  const [customerId, setCustomerId] = useState(estimate?.customer.id ?? "");
  const [locationId, setLocationId] = useState(estimate?.location.id ?? "");
  const [status, setStatus] = useState<EstimateStatus>(
    estimate?.status ?? "DRAFT",
  );
  const [issuedAt, setIssuedAt] = useState(toDateInput(estimate?.issuedAt));
  const [expiresAt, setExpiresAt] = useState(toDateInput(estimate?.expiresAt));
  const [taxRate, setTaxRate] = useState(String(estimate?.taxRate ?? 0));
  const [notes, setNotes] = useState(estimate?.notes ?? "");
  const [lines, setLines] = useState<LineItemDraft[]>(
    estimate ? draftFromItems(estimate.lineItems) : [emptyLine()],
  );
  const [errors, setErrors] = useState<{ title?: string; location?: string }>(
    {},
  );

  const save = useMutation({
    mutationFn: (input: CreateEstimateInput) =>
      estimate
        ? api.estimates.update(estimate.id, input)
        : api.estimates.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
      void queryClient.invalidateQueries({ queryKey: ["ops"] });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(estimate ? "Estimate updated" : "Estimate created");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = "Give the estimate a short title.";
    if (!customerId || !locationId) {
      nextErrors.location = "Choose the customer and the service location.";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    save.mutate({
      title: title.trim(),
      customerId,
      locationId,
      status,
      issuedAt: fromDateInput(issuedAt),
      expiresAt: fromDateInput(expiresAt),
      taxRate: Number(taxRate) || 0,
      notes: notes.trim() || null,
      lineItems: toLineInputs(lines),
    });
  }

  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={estimate ? `Edit ${estimate.number}` : "New estimate"}
      description="Price the scope before it becomes a booked job."
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
            {estimate ? "Save estimate" : "Create estimate"}
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
          label="Estimate title"
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
            placeholder="Full exterior window clean"
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status" htmlFor={id("status")}>
            <Select
              id={id("status")}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as EstimateStatus)
              }
            >
              {ESTIMATE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ESTIMATE_STATUS_META[value].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issued" htmlFor={id("issued")}>
            <Input
              id={id("issued")}
              type="date"
              value={issuedAt}
              onChange={(event) => setIssuedAt(event.target.value)}
            />
          </Field>
          <Field label="Expires" htmlFor={id("expires")}>
            <Input
              id={id("expires")}
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Field>
        </div>

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
            placeholder="Scope assumptions, access details, exclusions…"
          />
        </Field>
      </form>
    </Modal>
  );
}
