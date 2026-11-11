import { api, type LineItemInput } from "@meridian/api-client";
import {
  ESTIMATE_STATUS_META,
  INVOICE_STATUS_META,
  JOB_STATUS_META,
  type EstimateStatus,
  type InvoiceStatus,
  type JobStatus,
} from "@meridian/contracts";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatMoney, toCents } from "../../lib/utils";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO string → value for `<input type="datetime-local">` in local time. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** ISO string → value for `<input type="date">` in local time. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function money(cents: number | null | undefined, currency: string): string {
  return formatMoney(cents ?? 0, currency);
}

export function customerTypeLabel(value: string | null | undefined): string {
  switch (value) {
    case "RESIDENTIAL":
      return "Residential";
    case "COMMERCIAL":
      return "Commercial";
    case "PROPERTY_MANAGER":
      return "Property manager";
    default:
      return "—";
  }
}

/* -------------------------------------------------------------------------- */
/* Status badges                                                               */
/* -------------------------------------------------------------------------- */

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const meta = JOB_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  const meta = ESTIMATE_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function InvoiceStatusBadge({
  status,
  overdue,
}: {
  status: InvoiceStatus;
  overdue?: boolean;
}) {
  const meta = INVOICE_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={meta.tone}>{meta.label}</Badge>
      {overdue ? <Badge tone="danger">Overdue</Badge> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference data                                                              */
/* -------------------------------------------------------------------------- */

export function usePriceBook() {
  return useQuery({
    queryKey: queryKeys.services.list({ pageSize: 100, archive: "active", sort: "name" }),
    queryFn: () => api.services.list({ pageSize: 100, archive: "active", sort: "name" }),
    staleTime: 60_000,
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: queryKeys.companies.list({ pageSize: 100, archive: "active", sort: "name" }),
    queryFn: () => api.companies.list({ pageSize: 100, archive: "active", sort: "name" }),
    staleTime: 60_000,
  });
}

export function useCustomerLocations(customerId: string) {
  return useQuery({
    queryKey: queryKeys.locations.list({ customerId, pageSize: 100, archive: "active" }),
    queryFn: () => api.locations.list({ customerId, pageSize: 100, archive: "active" }),
    enabled: Boolean(customerId),
    staleTime: 60_000,
  });
}

export function useMembers() {
  return useQuery({
    queryKey: queryKeys.workspace.members,
    queryFn: () => api.workspace.members(),
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Line items                                                                  */
/* -------------------------------------------------------------------------- */

export interface LineItemDraft {
  key: string;
  serviceId: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

let lineKey = 0;

function nextKey(): string {
  lineKey += 1;
  return `line-${lineKey}`;
}

export function emptyLine(): LineItemDraft {
  return { key: nextKey(), serviceId: "", name: "", quantity: "1", unitPrice: "" };
}

export function draftFromItems(items: LineItemInput[]): LineItemDraft[] {
  if (items.length === 0) return [emptyLine()];
  return items.map((item) => ({
    key: nextKey(),
    serviceId: item.serviceId ?? "",
    name: item.name,
    quantity: String(item.quantity),
    unitPrice: (item.unitPrice / 100).toFixed(2),
  }));
}

export function toLineInputs(lines: LineItemDraft[]): LineItemInput[] {
  return lines
    .filter((line) => line.name.trim())
    .map((line) => ({
      serviceId: line.serviceId || null,
      name: line.name.trim(),
      quantity: Math.max(0.01, Number(line.quantity) || 0),
      unitPrice: toCents(line.unitPrice),
    }));
}

export function draftSubtotal(lines: LineItemDraft[]): number {
  return lines.reduce(
    (sum, line) =>
      sum + Math.round((Number(line.quantity) || 0) * toCents(line.unitPrice)),
    0,
  );
}

interface LineItemsEditorProps {
  lines: LineItemDraft[];
  onChange: (lines: LineItemDraft[]) => void;
  currency: string;
}

export function LineItemsEditor({ lines, onChange, currency }: LineItemsEditorProps) {
  const servicesQuery = usePriceBook();
  const services = servicesQuery.data?.data ?? [];
  const prefix = useId();

  function update(key: string, patch: Partial<LineItemDraft>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="label-micro">Line items</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...lines, emptyLine()])}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add line
        </Button>
      </div>

      {lines.map((line) => {
        const lineTotal = Math.round((Number(line.quantity) || 0) * toCents(line.unitPrice));
        return (
          <div
            key={line.key}
            className="grid gap-2 rounded-card border border-border bg-surface-2/40 p-3 sm:grid-cols-[minmax(0,1.4fr)_88px_112px_auto]"
          >
            <Field label="Service" htmlFor={`${prefix}-service-${line.key}`} className="min-w-0">
              <Select
                id={`${prefix}-service-${line.key}`}
                value={line.serviceId}
                onChange={(event) => {
                  const service = services.find((item) => item.id === event.target.value);
                  if (service) {
                    update(line.key, {
                      serviceId: service.id,
                      name: service.name,
                      unitPrice: (service.price / 100).toFixed(2),
                    });
                  } else {
                    update(line.key, { serviceId: "" });
                  }
                }}
              >
                <option value="">Custom item</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Qty" htmlFor={`${prefix}-qty-${line.key}`}>
              <Input
                id={`${prefix}-qty-${line.key}`}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
              />
            </Field>

            <Field label={`Unit (${currency})`} htmlFor={`${prefix}-price-${line.key}`}>
              <Input
                id={`${prefix}-price-${line.key}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                placeholder="0.00"
              />
            </Field>

            <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end sm:justify-end">
              <span className="num text-sm text-fg">{money(lineTotal, currency)}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Remove line"
                onClick={() =>
                  onChange(
                    lines.length === 1 ? [emptyLine()] : lines.filter((item) => item.key !== line.key),
                  )
                }
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>

            <Field
              label="Description"
              htmlFor={`${prefix}-name-${line.key}`}
              className="sm:col-span-4"
            >
              <Input
                id={`${prefix}-name-${line.key}`}
                value={line.name}
                onChange={(event) => update(line.key, { name: event.target.value })}
                placeholder="What is being done"
                maxLength={160}
              />
            </Field>
          </div>
        );
      })}
    </div>
  );
}

export function TotalsPreview({
  lines,
  taxRate,
  currency,
  className,
}: {
  lines: LineItemDraft[];
  taxRate: string;
  currency: string;
  className?: string;
}) {
  const subtotal = draftSubtotal(lines);
  const rate = Math.max(0, Number(taxRate) || 0);
  const tax = Math.round((subtotal * rate) / 100);
  return (
    <dl
      className={cn(
        "grid gap-2 rounded-card border border-border bg-surface-2/40 p-4 text-sm sm:grid-cols-3",
        className,
      )}
    >
      <div>
        <dt className="label-micro">Subtotal</dt>
        <dd className="num mt-1 text-fg">{money(subtotal, currency)}</dd>
      </div>
      <div>
        <dt className="label-micro">Tax ({rate.toFixed(2)}%)</dt>
        <dd className="num mt-1 text-fg">{money(tax, currency)}</dd>
      </div>
      <div>
        <dt className="label-micro">Total</dt>
        <dd className="num mt-1 text-base text-fg">{money(subtotal + tax, currency)}</dd>
      </div>
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Customer + location picker                                                  */
/* -------------------------------------------------------------------------- */

export function CustomerLocationFields({
  customerId,
  locationId,
  onChange,
  disabled = false,
}: {
  customerId: string;
  locationId: string;
  onChange: (next: { customerId: string; locationId: string }) => void;
  disabled?: boolean;
}) {
  const { workspace } = useAuth();
  const customersQuery = useCustomers();
  const locationsQuery = useCustomerLocations(customerId);
  const customers = customersQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const prefix = useId();

  useEffect(() => {
    if (!customerId) return;
    if (locations.length === 0) return;
    if (locations.some((location) => location.id === locationId)) return;
    const primary = locations.find((location) => location.isPrimary) ?? locations[0];
    if (primary) onChange({ customerId, locationId: primary.id });
    // onChange is intentionally omitted: it changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, locationId, locations]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer" htmlFor={`${prefix}-customer`} required>
        <Select
          id={`${prefix}-customer`}
          value={customerId}
          disabled={disabled}
          onChange={(event) => onChange({ customerId: event.target.value, locationId: "" })}
        >
          <option value="">
            {customersQuery.isPending ? "Loading customers…" : "Select a customer"}
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Service location"
        htmlFor={`${prefix}-location`}
        required
        hint={
          customerId && !locationsQuery.isPending && locations.length === 0
            ? "Add a location on the customer record first."
            : undefined
        }
      >
        <Select
          id={`${prefix}-location`}
          value={locationId}
          disabled={disabled || !customerId}
          onChange={(event) => onChange({ customerId, locationId: event.target.value })}
        >
          <option value="">
            {!customerId
              ? "Pick a customer first"
              : locationsQuery.isPending
                ? "Loading locations…"
                : "Select a location"}
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label} · {location.line1}, {location.city}
            </option>
          ))}
        </Select>
      </Field>
      {customerId ? (
        <p className="text-xs text-muted sm:col-span-2">
          {workspace?.currency ?? "USD"} · addresses are managed on the customer record.
        </p>
      ) : null}
    </div>
  );
}
