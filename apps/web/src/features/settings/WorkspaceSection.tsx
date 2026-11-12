import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api, ApiError, type Currency } from "@meridian/api-client";
import {
  atLeast,
  BUSINESS_TYPE_META,
  BUSINESS_TYPES,
  CURRENCIES,
  type BusinessType,
} from "@meridian/contracts";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate } from "../../lib/utils";

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function WorkspaceSection() {
  const { workspace, role, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const canManage = role ? atLeast(role, "ADMIN") : false;
  const [name, setName] = useState(workspace?.name ?? "");
  const [currency, setCurrency] = useState<Currency>((workspace?.currency as Currency) ?? "USD");
  const [businessType, setBusinessType] = useState<BusinessType>(
    (workspace?.businessType as BusinessType) ?? "GENERAL",
  );
  const [timezone, setTimezone] = useState(workspace?.timezone ?? "UTC");
  const [serviceArea, setServiceArea] = useState(workspace?.serviceArea ?? "");
  const [depotLatitude, setDepotLatitude] = useState(
    workspace?.depotLatitude !== null && workspace?.depotLatitude !== undefined
      ? String(workspace.depotLatitude)
      : "",
  );
  const [depotLongitude, setDepotLongitude] = useState(
    workspace?.depotLongitude !== null && workspace?.depotLongitude !== undefined
      ? String(workspace.depotLongitude)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setCurrency((workspace?.currency as Currency) ?? "USD");
    setBusinessType((workspace?.businessType as BusinessType) ?? "GENERAL");
    setTimezone(workspace?.timezone ?? "UTC");
    setServiceArea(workspace?.serviceArea ?? "");
    setDepotLatitude(
      workspace?.depotLatitude !== null && workspace?.depotLatitude !== undefined
        ? String(workspace.depotLatitude)
        : "",
    );
    setDepotLongitude(
      workspace?.depotLongitude !== null && workspace?.depotLongitude !== undefined
        ? String(workspace.depotLongitude)
        : "",
    );
  }, [workspace]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      setError("Workspace name must be between 2 and 80 characters.");
      return;
    }
    const trimmedTimezone = timezone.trim();
    if (!trimmedTimezone) {
      setError("Timezone is required (for example America/New_York).");
      return;
    }

    const latitudeInput = depotLatitude.trim();
    const longitudeInput = depotLongitude.trim();
    let latitudeValue: number | null = null;
    let longitudeValue: number | null = null;
    if (latitudeInput) {
      const parsed = Number(latitudeInput);
      if (!Number.isFinite(parsed) || parsed < -90 || parsed > 90) {
        setError("Depot latitude must be between -90 and 90.");
        return;
      }
      latitudeValue = parsed;
    }
    if (longitudeInput) {
      const parsed = Number(longitudeInput);
      if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) {
        setError("Depot longitude must be between -180 and 180.");
        return;
      }
      longitudeValue = parsed;
    }
    if ((latitudeInput && !longitudeInput) || (!latitudeInput && longitudeInput)) {
      setError("Set both depot latitude and longitude, or leave both blank.");
      return;
    }

    setSaving(true);
    try {
      await api.workspace.update({
        name: trimmed,
        currency,
        businessType,
        timezone: trimmedTimezone,
        serviceArea: serviceArea.trim() || null,
        depotLatitude: latitudeValue,
        depotLongitude: longitudeValue,
      });
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace.detail });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dispatch.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ops.summary() });
      toast.success("Workspace updated");
    } catch (cause) {
      const message = messageFor(cause, "Could not update the workspace.");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Workspace</CardTitle>
          <CardDescription className="mt-1">
            Identity, service defaults and the depot every route starts from.
          </CardDescription>
        </div>
        {role ? <Badge tone={atLeast(role, "ADMIN") ? "accent" : "neutral"}>{role}</Badge> : null}
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="workspace-name" required>
              <Input
                id="workspace-name"
                value={name}
                maxLength={80}
                disabled={!canManage}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Currency" htmlFor="workspace-currency" hint="Used for pipeline and revenue reporting.">
              <Select
                id="workspace-currency"
                value={currency}
                disabled={!canManage}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                {CURRENCIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Business type"
              htmlFor="workspace-business-type"
              hint="Defaults to home services and shapes drafts and labels."
            >
              <Select
                id="workspace-business-type"
                value={businessType}
                disabled={!canManage}
                onChange={(event) => setBusinessType(event.target.value as BusinessType)}
              >
                {BUSINESS_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {BUSINESS_TYPE_META[option].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Timezone"
              htmlFor="workspace-timezone"
              hint="IANA zone used for schedules, e.g. America/New_York."
            >
              <Input
                id="workspace-timezone"
                value={timezone}
                maxLength={64}
                disabled={!canManage}
                placeholder="America/New_York"
                onChange={(event) => setTimezone(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Service area"
            htmlFor="workspace-service-area"
            hint="Default area shown on schedules and customer drafts."
          >
            <Input
              id="workspace-service-area"
              value={serviceArea}
              maxLength={160}
              disabled={!canManage}
              placeholder="Austin, TX and surrounding areas"
              onChange={(event) => setServiceArea(event.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Depot latitude"
              htmlFor="workspace-depot-latitude"
              hint="Optional. Route start point, between -90 and 90."
            >
              <Input
                id="workspace-depot-latitude"
                inputMode="decimal"
                value={depotLatitude}
                disabled={!canManage}
                placeholder="30.2672"
                onChange={(event) => setDepotLatitude(event.target.value)}
              />
            </Field>
            <Field
              label="Depot longitude"
              htmlFor="workspace-depot-longitude"
              hint="Optional. Set together with latitude, between -180 and 180."
            >
              <Input
                id="workspace-depot-longitude"
                inputMode="decimal"
                value={depotLongitude}
                disabled={!canManage}
                placeholder="-97.7431"
                onChange={(event) => setDepotLongitude(event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug" htmlFor="workspace-slug">
              <Input id="workspace-slug" value={workspace?.slug ?? ""} readOnly className="opacity-60" />
            </Field>
            <Field label="Created" htmlFor="workspace-created">
              <Input
                id="workspace-created"
                value={formatDate(workspace?.createdAt)}
                readOnly
                className="opacity-60"
              />
            </Field>
          </div>

          {!canManage ? (
            <p className="flex items-start gap-2 rounded-input border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Only workspace admins can change these settings. You can still review them here.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm leading-relaxed text-danger">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!canManage}
            title={!canManage ? "Admins only" : undefined}
          >
            Save workspace
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
