import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@meridian/api-client";
import { atLeast } from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDateTime, useDebouncedValue } from "../../lib/utils";

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function AuditTable() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const query = useQuery({
    queryKey: queryKeys.workspace.audit({
      page,
      pageSize: 20,
      q: debouncedSearch.trim() || undefined,
    }),
    queryFn: () =>
      api.workspace.audit({
        page,
        pageSize: 20,
        q: debouncedSearch.trim() || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const entries = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Audit trail</CardTitle>
          <CardDescription className="mt-1">
            Every structural change, newest first.
          </CardDescription>
        </div>
        <div className="relative w-full sm:max-w-[240px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            aria-label="Search audit trail"
            placeholder="Filter action or entity"
            className="pl-9"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {query.isLoading ? (
          <div
            className="divide-y divide-border"
            role="status"
            aria-label="Loading audit trail"
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </div>
        ) : null}

        {query.isError ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm font-medium text-fg">
              Could not load the audit trail
            </p>
            <p className="mt-1.5 text-sm text-muted">
              {messageFor(query.error, "Check your connection and try again.")}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : null}

        {query.isSuccess && entries.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-fg">No audit events yet</p>
            <p className="mt-1.5 text-sm text-muted">
              Changes to members, deals, stages and activities will appear here.
            </p>
          </div>
        ) : null}

        {entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-y border-border text-[10px] uppercase tracking-[0.16em] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-black">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-black">
                    Actor
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-black">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-black">
                    Entity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      <span title={entry.createdAt}>
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={entry.actor?.name ?? "System"}
                          src={entry.actor?.avatarUrl}
                          size="xs"
                        />
                        <span className="truncate text-xs text-fg">
                          {entry.actor?.name ?? "System"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-fg">
                        {entry.action}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      <span className="capitalize">{entry.entityType}</span>
                      {entry.entityId ? (
                        <span className="num ml-1.5 text-muted/60">
                          {entry.entityId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {meta ? (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              {meta.total} {meta.total === 1 ? "event" : "events"} · page{" "}
              {meta.page} of {Math.max(1, meta.totalPages)}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={meta.page <= 1 || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={meta.page >= meta.totalPages || query.isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AuditSection() {
  const { role } = useAuth();
  const canView = role ? atLeast(role, "ADMIN") : false;

  if (!canView) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <span
            className="mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted"
            aria-hidden="true"
          >
            <Shield className="size-5" />
          </span>
          <p className="text-sm font-medium text-fg">Audit is admin-only</p>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            Ask a workspace admin for the audit trail. Your current role is{" "}
            {role ?? "unknown"}.
          </p>
        </div>
      </Card>
    );
  }

  return <AuditTable />;
}
