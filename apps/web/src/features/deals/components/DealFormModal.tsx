import type { CreateDealInput } from "@meridian/api-client";
import {
  CURRENCIES,
  type Currency,
  type Deal,
  type Stage,
} from "@meridian/contracts";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import { Textarea } from "../../../components/ui/Textarea";
import { fromCents, toCents } from "../../../lib/utils";
import { useCreateDeal, useDealLookups, useUpdateDeal } from "../hooks";
import { errorMessage } from "../lib/deals";

interface DealFormState {
  title: string;
  value: string;
  currency: Currency;
  stageId: string;
  companyId: string;
  contactId: string;
  expectedCloseDate: string;
  description: string;
  tags: string;
}

function sanitizeCurrency(value: string): Currency {
  return (CURRENCIES as readonly string[]).includes(value)
    ? (value as Currency)
    : "USD";
}

function initialForm(stages: Stage[], currency: string): DealFormState {
  return {
    title: "",
    value: "",
    currency: sanitizeCurrency(currency),
    stageId:
      stages.find((stage) => stage.kind === "OPEN")?.id ?? stages[0]?.id ?? "",
    companyId: "",
    contactId: "",
    expectedCloseDate: "",
    description: "",
    tags: "",
  };
}

function formFromDeal(deal: Deal): DealFormState {
  return {
    title: deal.title,
    value: deal.value ? fromCents(deal.value) : "0.00",
    currency: sanitizeCurrency(deal.currency),
    stageId: deal.stageId,
    companyId: deal.company?.id ?? "",
    contactId: deal.contact?.id ?? "",
    expectedCloseDate: deal.expectedCloseDate
      ? deal.expectedCloseDate.slice(0, 10)
      : "",
    description: deal.description ?? "",
    tags: deal.tags.join(", "),
  };
}

interface DealFormModalProps {
  open: boolean;
  onClose: () => void;
  deal: Deal | null;
  stages: Stage[];
  defaultCurrency: string;
  onSaved: (deal: Deal) => void;
}

export function DealFormModal({
  open,
  onClose,
  deal,
  stages,
  defaultCurrency,
  onSaved,
}: DealFormModalProps) {
  const formId = useId();
  const titleId = `${formId}-title`;
  const valueId = `${formId}-value`;
  const currencyId = `${formId}-currency`;
  const stageIdField = `${formId}-stage`;
  const closeDateId = `${formId}-close`;
  const companyIdField = `${formId}-company`;
  const contactIdField = `${formId}-contact`;
  const descriptionId = `${formId}-description`;
  const tagsId = `${formId}-tags`;

  const [form, setForm] = useState<DealFormState>(() =>
    initialForm(stages, defaultCurrency),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lookups = useDealLookups(open);
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const mutation = deal ? updateDeal : createDeal;
  const pending = mutation.isPending;
  const mutationError = mutation.error;

  useEffect(() => {
    if (!open) return;
    createDeal.reset();
    updateDeal.reset();
    setErrors({});
    setForm(deal ? formFromDeal(deal) : initialForm(stages, defaultCurrency));
    // The mutation handles are stable; resetting on each render would wipe input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal, stages, defaultCurrency]);

  function setField<K extends keyof DealFormState>(
    key: K,
    value: DealFormState[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function handleClose() {
    if (pending) return;
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const numericValue = Number(form.value);
    const tags = form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!form.title.trim()) nextErrors.title = "Give the deal a title.";
    if (!form.stageId) nextErrors.stageId = "Choose a stage.";
    if (
      form.value.trim() === "" ||
      !Number.isFinite(numericValue) ||
      numericValue < 0
    ) {
      nextErrors.value = "Enter a valid amount in dollars.";
    }
    if (tags.length > 12) nextErrors.tags = "Use 12 tags or fewer.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: CreateDealInput = {
      title: form.title.trim(),
      value: toCents(form.value),
      currency: form.currency,
      stageId: form.stageId,
      companyId: form.companyId || null,
      contactId: form.contactId || null,
      expectedCloseDate: form.expectedCloseDate || null,
      description: form.description.trim() ? form.description.trim() : null,
      tags,
    };

    if (deal) {
      updateDeal.mutate(
        { id: deal.id, input: payload },
        {
          onSuccess: (saved) => onSaved(saved),
        },
      );
    } else {
      createDeal.mutate(payload, {
        onSuccess: (saved) => onSaved(saved),
      });
    }
  }

  const companies = lookups.companies.data?.data ?? [];
  const contacts = lookups.contacts.data?.data ?? [];
  const dealCompany = deal?.company ?? null;
  const dealContact = deal?.contact ?? null;
  const missingCompany =
    dealCompany && !companies.some((company) => company.id === dealCompany.id)
      ? dealCompany
      : null;
  const missingContact =
    dealContact && !contacts.some((contact) => contact.id === dealContact.id)
      ? dealContact
      : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={deal ? "Edit deal" : "New deal"}
      description={
        deal
          ? "Update the value, stage and details."
          : "Add a deal to the pipeline."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={`${formId}-form`}
            loading={pending}
            disabled={!stages.length}
          >
            {deal ? "Save changes" : "Create deal"}
          </Button>
        </>
      }
    >
      <form id={`${formId}-form`} onSubmit={handleSubmit} className="space-y-4">
        {mutationError ? (
          <p
            role="alert"
            className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {errorMessage(mutationError)}
          </p>
        ) : null}

        <Field
          label="Deal title"
          htmlFor={titleId}
          required
          error={errors.title}
        >
          <Input
            id={titleId}
            data-autofocus
            value={form.title}
            onChange={(event) => setField("title", event.target.value)}
            placeholder="e.g. Website rebuild"
            invalid={Boolean(errors.title)}
            maxLength={160}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
          <Field
            label="Value"
            htmlFor={valueId}
            required
            error={errors.value}
            hint="Entered in dollars. Stored as exact cents."
          >
            <Input
              id={valueId}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={form.value}
              onChange={(event) => setField("value", event.target.value)}
              placeholder="0.00"
              invalid={Boolean(errors.value)}
            />
          </Field>
          <Field label="Currency" htmlFor={currencyId}>
            <Select
              id={currencyId}
              value={form.currency}
              onChange={(event) =>
                setField("currency", sanitizeCurrency(event.target.value))
              }
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Stage"
            htmlFor={stageIdField}
            required
            error={errors.stageId}
          >
            <Select
              id={stageIdField}
              value={form.stageId}
              onChange={(event) => setField("stageId", event.target.value)}
              invalid={Boolean(errors.stageId)}
              disabled={!stages.length}
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected close" htmlFor={closeDateId}>
            <Input
              id={closeDateId}
              type="date"
              value={form.expectedCloseDate}
              onChange={(event) =>
                setField("expectedCloseDate", event.target.value)
              }
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company" htmlFor={companyIdField}>
            <Select
              id={companyIdField}
              value={form.companyId}
              onChange={(event) => setField("companyId", event.target.value)}
            >
              <option value="">
                {lookups.companies.isPending
                  ? "Loading companies…"
                  : "No company"}
              </option>
              {missingCompany ? (
                <option value={missingCompany.id}>{missingCompany.name}</option>
              ) : null}
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contact" htmlFor={contactIdField}>
            <Select
              id={contactIdField}
              value={form.contactId}
              onChange={(event) => setField("contactId", event.target.value)}
            >
              <option value="">
                {lookups.contacts.isPending
                  ? "Loading contacts…"
                  : "No contact"}
              </option>
              {missingContact ? (
                <option value={missingContact.id}>
                  {missingContact.firstName} {missingContact.lastName}
                </option>
              ) : null}
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName}
                  {contact.company ? ` · ${contact.company.name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Description" htmlFor={descriptionId}>
          <Textarea
            id={descriptionId}
            rows={3}
            value={form.description}
            onChange={(event) => setField("description", event.target.value)}
            placeholder="Context, scope or next steps…"
            maxLength={5000}
          />
        </Field>

        <Field
          label="Tags"
          htmlFor={tagsId}
          hint="Comma separated, up to 12."
          error={errors.tags}
        >
          <Input
            id={tagsId}
            value={form.tags}
            onChange={(event) => setField("tags", event.target.value)}
            placeholder="enterprise, q1"
            invalid={Boolean(errors.tags)}
          />
        </Field>

        {!stages.length ? (
          <p className="text-xs text-danger">
            No pipeline stages are available yet.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
