import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api, ApiError, type Currency } from "@meridian/api-client";
import { atLeast, CURRENCIES } from "@meridian/contracts";
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setCurrency((workspace?.currency as Currency) ?? "USD");
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

    setSaving(true);
    try {
      await api.workspace.update({ name: trimmed, currency });
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace.detail });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
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
            The name and reporting currency every member sees.
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
