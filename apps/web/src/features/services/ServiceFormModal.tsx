import { api, type CreateServiceInput, type ServiceItem } from "@meridian/api-client";
import {
  SERVICE_UNITS,
  SERVICE_UNIT_META,
  type ServiceUnit,
} from "@meridian/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { toCents } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

interface ServiceFormModalProps {
  service?: ServiceItem | null;
  categories: string[];
  onClose: () => void;
  onSaved: (service: ServiceItem) => void;
}

export function ServiceFormModal({
  service,
  categories,
  onClose,
  onSaved,
}: ServiceFormModalProps) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const formId = useId();

  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [unit, setUnit] = useState<ServiceUnit>(service?.unit ?? "VISIT");
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 60));
  const [price, setPrice] = useState(
    service ? (service.price / 100).toFixed(2) : "",
  );
  const [taxable, setTaxable] = useState(service?.taxable ?? true);
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});

  const categoryOptions = useMemo(() => {
    const values = new Set(categories.filter(Boolean));
    if (category.trim()) values.add(category.trim());
    return [...values].sort();
  }, [categories, category]);

  const save = useMutation({
    mutationFn: (input: CreateServiceInput) =>
      service ? api.services.update(service.id, input) : api.services.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.services.all });
      toast.success(service ? "Service updated" : "Service added");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  useEffect(() => {
    if (service) setName(service.name);
  }, [service]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "Name the service.";
    if (price.trim() && toCents(price) < 0) nextErrors.price = "Price cannot be negative.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    save.mutate({
      name: name.trim(),
      category: category.trim() || null,
      description: description.trim() || null,
      unit,
      durationMinutes: Math.max(5, Number(duration) || 60),
      price: toCents(price),
      taxable,
    });
  }

  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={service ? `Edit ${service.name}` : "New service"}
      description="One price-book entry that crews can add to jobs and estimates."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={save.isPending}>
            {service ? "Save service" : "Add service"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Service name" htmlFor={id("name")} required error={errors.name}>
          <Input
            id={id("name")}
            data-autofocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
            }}
            invalid={Boolean(errors.name)}
            maxLength={160}
            placeholder="Full exterior window clean"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor={id("category")} hint="Group the price book.">
            <Input
              id={id("category")}
              list={`${formId}-categories`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={80}
              placeholder="Windows"
            />
            <datalist id={`${formId}-categories`}>
              {categoryOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <Field label="Unit" htmlFor={id("unit")}>
            <Select
              id={id("unit")}
              value={unit}
              onChange={(event) => setUnit(event.target.value as ServiceUnit)}
            >
              {SERVICE_UNITS.map((value) => (
                <option key={value} value={value}>
                  {SERVICE_UNIT_META[value].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Price (${currency})`} htmlFor={id("price")} error={errors.price}>
            <Input
              id={id("price")}
              inputMode="decimal"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                if (errors.price) setErrors((current) => ({ ...current, price: undefined }));
              }}
              placeholder="0.00"
            />
          </Field>
          <Field label="Typical duration (minutes)" htmlFor={id("duration")}>
            <Input
              id={id("duration")}
              type="number"
              min="5"
              max="1440"
              step="5"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(event) => setTaxable(event.target.checked)}
            className="size-4 rounded border-border bg-surface accent-[var(--color-accent)]"
          />
          Taxable
        </label>

        <Field label="Description" htmlFor={id("description")}>
          <Textarea
            id={id("description")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What the crew does, what is included, anything to quote."
          />
        </Field>
      </form>
    </Modal>
  );
}
