import { api } from "@meridian/api-client";
import type { StudioSettings } from "@meridian/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Link2, Settings2, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { queryKeys } from "../../lib/query";
import { humanize, integrationTone, StudioErrorCard } from "./shared";

function SettingsSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="Loading Studio settings"
    >
      <Skeleton className="h-60 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export default function StudioSettingsPage() {
  const settingsQuery = useQuery({
    queryKey: queryKeys.studio.settings,
    queryFn: () => api.studio.settings(),
  });

  const settings: StudioSettings | undefined = settingsQuery.data;

  if (settingsQuery.isPending) return <SettingsSkeleton />;

  if (settingsQuery.isError || !settings) {
    return (
      <StudioErrorCard
        title="Could not load Studio settings."
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-light tracking-tight text-fg">Settings</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Studio bridge status and the public links this workspace points at.
        </p>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="size-4 text-muted" aria-hidden="true" />
              Integrations
            </CardTitle>
            <CardDescription>
              Server-side checks reported by the website service API.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {settings.integrations.length === 0 ? (
            <p className="text-sm text-muted">
              No integration checks were reported.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {settings.integrations.map((integration) => (
                <li
                  key={integration.key}
                  className="flex flex-col gap-2 rounded-input border border-border bg-surface-2/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{integration.label}</p>
                    {integration.detail ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        {integration.detail}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={integrationTone(integration.status)}>
                    {humanize(integration.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4 text-muted" aria-hidden="true" />
              Public links
            </CardTitle>
            <CardDescription>
              Where the CRM sends staff and customers for website actions.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {settings.links.length === 0 ? (
            <p className="text-sm text-muted">No public links configured.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {settings.links.map((link) => (
                <li key={`${link.label}-${link.url}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-input border border-border bg-surface-2/40 px-4 py-3 transition-colors hover:border-white/15 hover:bg-surface-2/70"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">
                        {link.label}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {link.url}
                      </span>
                    </span>
                    <ArrowUpRight
                      className="size-4 shrink-0 text-muted group-hover:text-accent"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted"
            aria-hidden="true"
          >
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">Security model</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              The website remains the system of record. The CRM calls the
              website with a server-only service token, never opens the website
              database and never receives password hashes. Every Studio write is
              audited in this workspace.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
