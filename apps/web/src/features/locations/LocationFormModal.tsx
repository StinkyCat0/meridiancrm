import {
  api,
  type CreateLocationInput,
  type Location,
} from "@meridian/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Textarea } from "../../components/ui/Textarea";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage } from "../companies/lib";

interface LocationFormModalProps {
  customerId: string;
  customerName: string;
  location?: Location | null;
  onClose: () => void;
  onSaved: (location: Location) => void;
}

export function LocationFormModal({
  customerId,
  customerName,
  location,
  onClose,
  onSaved,
}: LocationFormModalProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [label, setLabel] = useState(location?.label ?? "Main");
  const [line1, setLine1] = useState(location?.line1 ?? "");
  const [line2, setLine2] = useState(location?.line2 ?? "");
  const [city, setCity] = useState(location?.city ?? "");
  const [state, setState] = useState(location?.state ?? "");
  const [postalCode, setPostalCode] = useState(location?.postalCode ?? "");
  const [country, setCountry] = useState(location?.country ?? "");
  const [accessNotes, setAccessNotes] = useState(location?.accessNotes ?? "");
  const [gateCode, setGateCode] = useState(location?.gateCode ?? "");
  const [contactName, setContactName] = useState(location?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(location?.contactPhone ?? "");
  const [latitude, setLatitude] = useState(
    location?.latitude !== null && location?.latitude !== undefined
      ? String(location.latitude)
      : "",
  );
  const [longitude, setLongitude] = useState(
    location?.longitude !== null && location?.longitude !== undefined
      ? String(location.longitude)
      : "",
  );
  const [isPrimary, setIsPrimary] = useState(location?.isPrimary ?? false);
  const [errors, setErrors] = useState<{
    line1?: string;
    city?: string;
    latitude?: string;
    longitude?: string;
  }>({});

  const save = useMutation({
    mutationFn: (input: CreateLocationInput) =>
      location
        ? api.locations.update(location.id, input)
        : api.locations.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.companies.timeline(customerId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dispatch.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ops.summary() });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(location ? "Location updated" : "Location added");
      onSaved(saved);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const nextErrors: typeof errors = {};
    if (!line1.trim()) nextErrors.line1 = "Street address is required.";
    if (!city.trim()) nextErrors.city = "City is required.";

    const latitudeInput = latitude.trim();
    const longitudeInput = longitude.trim();
    let latitudeValue: number | null = null;
    let longitudeValue: number | null = null;
    if (latitudeInput) {
      const parsed = Number(latitudeInput);
      if (!Number.isFinite(parsed) || parsed < -90 || parsed > 90) {
        nextErrors.latitude = "Latitude must be between -90 and 90.";
      } else {
        latitudeValue = parsed;
      }
    }
    if (longitudeInput) {
      const parsed = Number(longitudeInput);
      if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) {
        nextErrors.longitude = "Longitude must be between -180 and 180.";
      } else {
        longitudeValue = parsed;
      }
    }
    if (!nextErrors.latitude && !nextErrors.longitude) {
      if (latitudeInput && !longitudeInput) {
        nextErrors.longitude = "Set longitude when latitude is provided.";
      } else if (longitudeInput && !latitudeInput) {
        nextErrors.latitude = "Set latitude when longitude is provided.";
      }
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    save.mutate({
      customerId,
      label: label.trim() || "Main",
      line1: line1.trim(),
      line2: line2.trim() || null,
      city: city.trim(),
      state: state.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country.trim() || null,
      accessNotes: accessNotes.trim() || null,
      gateCode: gateCode.trim() || null,
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      latitude: latitudeValue,
      longitude: longitudeValue,
      isPrimary,
    });
  }

  const id = (field: string) => `${formId}-${field}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={location ? `Edit ${location.label}` : "New service location"}
      description={`Where the work happens for ${customerName}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={save.isPending}>
            {location ? "Save location" : "Add location"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Field label="Label" htmlFor={id("label")} hint="Main, Annex, Unit 4…">
            <Input
              id={id("label")}
              data-autofocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={60}
            />
          </Field>
          <Field label="Street address" htmlFor={id("line1")} required error={errors.line1}>
            <Input
              id={id("line1")}
              value={line1}
              onChange={(event) => {
                setLine1(event.target.value);
                if (errors.line1) setErrors((current) => ({ ...current, line1: undefined }));
              }}
              invalid={Boolean(errors.line1)}
              maxLength={200}
              placeholder="18 Mercer Street"
            />
          </Field>
        </div>

        <Field label="Address line 2" htmlFor={id("line2")}>
          <Input
            id={id("line2")}
            value={line2}
            onChange={(event) => setLine2(event.target.value)}
            maxLength={120}
            placeholder="Suite, floor, unit"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor={id("city")} required error={errors.city}>
            <Input
              id={id("city")}
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
                if (errors.city) setErrors((current) => ({ ...current, city: undefined }));
              }}
              invalid={Boolean(errors.city)}
              maxLength={120}
            />
          </Field>
          <Field label="State / region" htmlFor={id("state")}>
            <Input
              id={id("state")}
              value={state}
              onChange={(event) => setState(event.target.value)}
              maxLength={80}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postal code" htmlFor={id("postal")}>
            <Input
              id={id("postal")}
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              maxLength={20}
            />
          </Field>
          <Field label="Country" htmlFor={id("country")}>
            <Input
              id={id("country")}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              maxLength={80}
              placeholder="United States"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Latitude"
            htmlFor={id("latitude")}
            error={errors.latitude}
            hint="Optional. Enables dispatch routing and the map link."
          >
            <Input
              id={id("latitude")}
              inputMode="decimal"
              value={latitude}
              onChange={(event) => {
                setLatitude(event.target.value);
                if (errors.latitude) {
                  setErrors((current) => ({ ...current, latitude: undefined }));
                }
              }}
              invalid={Boolean(errors.latitude)}
              placeholder="30.2672"
            />
          </Field>
          <Field
            label="Longitude"
            htmlFor={id("longitude")}
            error={errors.longitude}
            hint="Optional. Must be set together with latitude."
          >
            <Input
              id={id("longitude")}
              inputMode="decimal"
              value={longitude}
              onChange={(event) => {
                setLongitude(event.target.value);
                if (errors.longitude) {
                  setErrors((current) => ({ ...current, longitude: undefined }));
                }
              }}
              invalid={Boolean(errors.longitude)}
              placeholder="-97.7431"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site contact" htmlFor={id("contact")}>
            <Input
              id={id("contact")}
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              maxLength={120}
              placeholder="Building manager"
            />
          </Field>
          <Field label="Contact phone" htmlFor={id("contactPhone")}>
            <Input
              id={id("contactPhone")}
              type="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              maxLength={40}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gate code" htmlFor={id("gate")} hint="Kept with the location record.">
            <Input
              id={id("gate")}
              value={gateCode}
              onChange={(event) => setGateCode(event.target.value)}
              maxLength={60}
            />
          </Field>
          <label className="flex items-end gap-2.5 pb-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
              className="size-4 rounded border-border bg-surface accent-[var(--color-accent)]"
            />
            Primary service location
          </label>
        </div>

        <Field label="Access notes" htmlFor={id("access")}>
          <Textarea
            id={id("access")}
            value={accessNotes}
            onChange={(event) => setAccessNotes(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Parking, dogs, elevator, roof access…"
          />
        </Field>
      </form>
    </Modal>
  );
}
