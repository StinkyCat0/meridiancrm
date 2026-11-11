import { api, type Job } from "@meridian/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, MapPin, Plus, Search, Wrench } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import type { JobScope } from "@meridian/api-client";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatDate, formatMoney, useDebouncedValue } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { JobStatusBadge } from "../operations/shared";
import { JobDetailModal } from "./JobDetailModal";
import { JobFormModal } from "./JobFormModal";

const SCOPES: { value: JobScope; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "upcoming", label: "Upcoming" },
  { value: "unscheduled", label: "Unscheduled" },
  { value: "open", label: "All open" },
  { value: "all", label: "Everything" },
];

export default function SchedulePage() {
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("job");
  const creating = params.get("new") === "1";
  const defaultCustomerId = params.get("customerId") ?? "";
  const [scope, setScope] = useState<JobScope>(() => {
    const value = params.get("scope");
    return SCOPES.some((item) => item.value === value) ? (value as JobScope) : "week";
  });
  const [search, setSearch] = useState("");
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({
      scope,
      q: debouncedSearch.trim() || undefined,
      pageSize: 100,
      sort: "scheduledStart",
      order: "asc",
    }),
    queryFn: () =>
      api.jobs.list({
        scope,
        q: debouncedSearch.trim() || undefined,
        pageSize: 100,
        sort: "scheduledStart",
        order: "asc",
      }),
    placeholderData: keepPreviousData,
  });

  const jobs = jobsQuery.data?.data ?? [];
  const total = jobsQuery.data?.meta.total ?? 0;
  const hasFilters = Boolean(search.trim()) || scope !== "week";

  function setParam(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  }

  function openJob(id: string) {
    setParam("job", id);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="FIELD OPERATIONS"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Schedule
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {jobsQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="Every visit, crew assignment and work order in one dispatch board."
        actions={
          <Button variant="primary" onClick={() => setParam("new", "1")}>
            <Plus className="size-4" aria-hidden="true" />
            New job
          </Button>
        }
      />

      <Card className="space-y-3 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs by number, title or customer"
              aria-label="Search jobs"
              className="pl-9"
            />
          </div>
          <p aria-live="polite" className="num shrink-0 text-xs text-muted">
            {jobsQuery.isError
              ? "—"
              : jobsQuery.data
                ? `${total} ${total === 1 ? "job" : "jobs"}`
                : "Loading"}
          </p>
        </div>
        <Tabs
          ariaLabel="Job scope"
          items={SCOPES.map((item) => ({ value: item.value, label: item.label }))}
          value={scope}
          onChange={(value) => setScope(value as JobScope)}
          className="border-0"
        />
      </Card>

      {jobsQuery.isPending ? (
        <JobListSkeleton />
      ) : jobsQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">Could not load the schedule.</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(jobsQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void jobsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title={hasFilters ? "No jobs in this view." : "No jobs scheduled yet."}
          description={
            hasFilters
              ? "Try another date range or clear the search."
              : "Create the first work order and put a crew on it."
          }
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setScope("week");
                }}
              >
                Reset view
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setParam("new", "1")}>
                <Plus className="size-4" aria-hidden="true" />
                New job
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-4 py-3">
                      When
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Job
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Location
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Assigned
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="label-micro px-4 py-3 text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      tabIndex={0}
                      aria-label={`Open ${job.number}`}
                      onClick={() => openJob(job.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, job.id, openJob)}
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {job.scheduledStart ? (
                          <>
                            <p className="text-fg">{formatDate(job.scheduledStart, "EEE, MMM d")}</p>
                            <p className="num text-xs text-muted">
                              {formatDate(job.scheduledStart, "h:mm a")} · {job.durationMinutes}m
                            </p>
                          </>
                        ) : (
                          <span className="text-muted">Unscheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="num text-xs text-accent">{job.number}</p>
                        <p className="max-w-[240px] truncate font-medium text-fg">{job.title}</p>
                        <p className="max-w-[240px] truncate text-xs text-muted">
                          {job.customer.name}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate text-fg">{job.location.label}</p>
                        <p className="max-w-[180px] truncate text-xs text-muted">
                          {job.location.line1}, {job.location.city}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {job.assignee ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={job.assignee.name} src={job.assignee.avatarUrl} size="xs" />
                            <span className="max-w-[120px] truncate text-muted">
                              {job.assignee.name}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <JobStatusBadge status={job.status} />
                          {job.priority === "URGENT" || job.priority === "HIGH" ? (
                            <Badge tone={job.priority === "URGENT" ? "danger" : "warning"}>
                              {job.priority}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right text-fg">
                        {formatMoney(job.total, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => openJob(job.id)}
                className="w-full rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num text-xs text-accent">{job.number}</p>
                    <p className="truncate font-medium text-fg">{job.title}</p>
                    <p className="truncate text-xs text-muted">{job.customer.name}</p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-muted">
                    <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {job.scheduledStart
                        ? formatDate(job.scheduledStart, "MMM d · h:mm a")
                        : "Unscheduled"}
                    </span>
                  </span>
                  <span className="num shrink-0 text-fg">{formatMoney(job.total, currency)}</span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  {job.location.label} · {job.location.city}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {creating ? (
        <JobFormModal
          defaultCustomerId={defaultCustomerId}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("new");
            next.delete("customerId");
            setParams(next, { replace: true });
          }}
          onSaved={(job) => {
            setParams(
              () => {
                const next = new URLSearchParams();
                next.set("job", job.id);
                return next;
              },
              { replace: true },
            );
          }}
        />
      ) : null}

      {selectedId ? (
        <JobDetailModal
          jobId={selectedId}
          onClose={() => setParam("job", null)}
          onEdit={(job) => setEditingJob(job)}
          onDuplicated={(job) => setParam("job", job.id)}
        />
      ) : null}

      {editingJob ? (
        <JobFormModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSaved={(job) => {
            setEditingJob(null);
            openJob(job.id);
          }}
        />
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  id: string,
  open: (jobId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function JobListSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-8 w-24 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="hidden h-3 w-32 lg:block" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-card border border-border bg-surface p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-3 h-3 w-1/3" />
          </div>
        ))}
      </div>
    </>
  );
}
