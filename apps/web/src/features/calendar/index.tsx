import { api, type Job, type JobStatus } from "@meridian/api-client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { queryKeys } from "../../lib/query";
import { cn } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { useMembers } from "../operations/shared";

const HOUR_START = 7;
const HOUR_END = 19;
const HOUR_HEIGHT = 56;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
const DAY_MS = 86_400_000;
const MIN_BLOCK_HEIGHT = 20;

const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => HOUR_START + index);

const TECH_COLORS = [
  "#22d3ee",
  "#8b5cf6",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#a3e635",
  "#f472b6",
];

const UTC_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const STATUS_TONE: Record<JobStatus, "neutral" | "accent" | "warning" | "success" | "danger"> = {
  UNSCHEDULED: "neutral",
  SCHEDULED: "accent",
  DISPATCHED: "warning",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELED: "danger",
  NO_SHOW: "danger",
};

function shiftDayKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string): Date {
  const parts = key.slice(0, 10).split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

/** Monday of the UTC week that contains `dateKey`. */
function startOfUtcWeek(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return shiftDayKey(dateKey, -offset);
}

function colorForTechnician(technicianId: string | null): string {
  if (!technicianId) return "#94a3b8";
  let hash = 0;
  for (let index = 0; index < technicianId.length; index += 1) {
    hash = (hash * 31 + technicianId.charCodeAt(index)) >>> 0;
  }
  return TECH_COLORS[hash % TECH_COLORS.length] ?? "#22d3ee";
}

function formatTimeRange(job: Job): string {
  if (!job.scheduledStart) return "Unscheduled";
  const start = new Date(job.scheduledStart);
  if (Number.isNaN(start.getTime())) return "Unscheduled";
  const parsedEnd = job.scheduledEnd ? new Date(job.scheduledEnd) : null;
  const end =
    parsedEnd && !Number.isNaN(parsedEnd.getTime())
      ? parsedEnd
      : new Date(start.getTime() + Math.max(15, job.durationMinutes) * 60_000);
  return `${UTC_TIME.format(start)} – ${UTC_TIME.format(end)}`;
}

interface RawSegment {
  job: Job;
  dayIndex: number;
  startMin: number;
  endMin: number;
}

interface CalendarSegment extends RawSegment {
  col: number;
  cols: number;
}

/** Split each job across the UTC days it occupies, clip to the 7–19 window and lay overlaps side-by-side. */
function buildSegments(jobs: Job[], days: string[]): CalendarSegment[] {
  const raw: RawSegment[] = [];

  for (const job of jobs) {
    if (!job.scheduledStart) continue;
    const start = new Date(job.scheduledStart);
    if (Number.isNaN(start.getTime())) continue;
    const end = job.scheduledEnd ? new Date(job.scheduledEnd) : null;
    const endTime = Math.max(
      end && !Number.isNaN(end.getTime())
        ? end.getTime()
        : start.getTime() + Math.max(15, job.durationMinutes) * 60_000,
      start.getTime() + 15 * 60_000,
    );

    days.forEach((dayKey, dayIndex) => {
      const dayStart = Date.parse(`${dayKey}T00:00:00.000Z`);
      const dayEnd = dayStart + DAY_MS;
      if (start.getTime() >= dayEnd || endTime <= dayStart) return;

      const startMin = (Math.max(start.getTime(), dayStart) - dayStart) / 60_000;
      const endMin = (Math.min(endTime, dayEnd) - dayStart) / 60_000;
      const clippedStart = Math.max(startMin, HOUR_START * 60);
      const clippedEnd = Math.min(endMin, HOUR_END * 60);
      if (clippedEnd <= clippedStart) return;

      raw.push({ job, dayIndex, startMin: clippedStart, endMin: clippedEnd });
    });
  }

  const segments: CalendarSegment[] = [];
  const byDay = new Map<number, RawSegment[]>();
  for (const segment of raw) {
    const list = byDay.get(segment.dayIndex);
    if (list) list.push(segment);
    else byDay.set(segment.dayIndex, [segment]);
  }

  for (const daySegments of byDay.values()) {
    daySegments.sort((left, right) => left.startMin - right.startMin || left.endMin - right.endMin);

    let cluster: RawSegment[] = [];
    let clusterEnd = -1;

    const flush = () => {
      if (cluster.length === 0) return;
      const active: { end: number; col: number }[] = [];
      const placed = cluster.map((segment) => {
        for (let index = active.length - 1; index >= 0; index -= 1) {
          const entry = active[index];
          if (entry && entry.end <= segment.startMin) active.splice(index, 1);
        }
        const used = new Set(active.map((entry) => entry.col));
        let col = 0;
        while (used.has(col)) col += 1;
        active.push({ end: segment.endMin, col });
        return { segment, col };
      });
      const cols = placed.reduce((max, entry) => Math.max(max, entry.col + 1), 1);
      for (const entry of placed) segments.push({ ...entry.segment, col: entry.col, cols });
      cluster = [];
      clusterEnd = -1;
    };

    for (const segment of daySegments) {
      if (cluster.length > 0 && segment.startMin >= clusterEnd) flush();
      cluster.push(segment);
      clusterEnd = Math.max(clusterEnd, segment.endMin);
    }
    flush();
  }

  return segments;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const members = useMembers().data ?? [];
  const todayKey = new Date().toISOString().slice(0, 10);

  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const weekStartKey = useMemo(() => startOfUtcWeek(anchorKey), [anchorKey]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftDayKey(weekStartKey, index)),
    [weekStartKey],
  );
  const weekEndKey = days[6] ?? weekStartKey;
  const from = weekStartKey;
  const to = weekEndKey;

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({ from, to, pageSize: 100, assigneeId: assigneeFilter || undefined }),
    queryFn: () =>
      api.jobs.list({
        from,
        to,
        pageSize: 100,
        sort: "scheduledStart",
        order: "asc",
        assigneeId: assigneeFilter || undefined,
      }),
  });

  const unscheduledQuery = useQuery({
    queryKey: queryKeys.jobs.list({ scope: "unscheduled", pageSize: 1, assigneeId: assigneeFilter || undefined }),
    queryFn: () =>
      api.jobs.list({
        scope: "unscheduled",
        pageSize: 1,
        assigneeId: assigneeFilter || undefined,
      }),
  });

  const jobs = useMemo(() => {
    const rows = jobsQuery.data?.data ?? [];
    return assigneeFilter ? rows.filter((job) => job.assignee?.id === assigneeFilter) : rows;
  }, [jobsQuery.data, assigneeFilter]);

  const segments = useMemo(() => buildSegments(jobs, days), [jobs, days]);
  const total = jobsQuery.data?.meta.total ?? 0;
  const loadedCount = jobsQuery.data?.data.length ?? 0;
  const truncated = jobsQuery.data ? total > loadedCount : false;
  const unscheduledCount = unscheduledQuery.data?.meta.total ?? 0;
  const todayInWeek = days.includes(now.toISOString().slice(0, 10));
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const showNowLine = todayInWeek && nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;

  const technicians = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of jobs) {
      if (job.assignee) map.set(job.assignee.id, job.assignee.name);
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [jobs]);

  const technicianOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.user.id, member.user.name);
    for (const technician of technicians) map.set(technician.id, technician.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [members, technicians]);

  const outOfHours = useMemo(
    () =>
      jobs.filter((job) => {
        if (!job.scheduledStart) return false;
        const start = new Date(job.scheduledStart);
        if (Number.isNaN(start.getTime())) return false;
        return start.getUTCHours() < HOUR_START || start.getUTCHours() >= HOUR_END;
      }).length,
    [jobs],
  );

  const filterName = technicianOptions.find((option) => option.id === assigneeFilter)?.name;
  const hasFilters = Boolean(assigneeFilter);

  const agendaDays = useMemo(
    () =>
      days.map((dayKey) => ({
        dayKey,
        jobs: jobs
          .filter((job) => {
            if (!job.scheduledStart) return false;
            const start = new Date(job.scheduledStart);
            return !Number.isNaN(start.getTime()) && start.toISOString().slice(0, 10) === dayKey;
          })
          .sort((left, right) => {
            const leftTime = left.scheduledStart ? new Date(left.scheduledStart).getTime() : 0;
            const rightTime = right.scheduledStart ? new Date(right.scheduledStart).getTime() : 0;
            return leftTime - rightTime;
          }),
      })),
    [days, jobs],
  );

  function changeWeek(direction: number) {
    setAnchorKey(shiftDayKey(weekStartKey, direction * 7));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="FIELD OPERATIONS"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Calendar
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {jobsQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="A week at a glance for every crew. Click a block to open the job."
      />

      <Card className="p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Previous week"
                onClick={() => changeWeek(-1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAnchorKey(new Date().toISOString().slice(0, 10))}
              >
                This week
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Next week"
                onClick={() => changeWeek(1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-sm font-medium text-fg">
              {format(dateFromKey(weekStartKey), "MMM d")} –{" "}
              {format(dateFromKey(weekEndKey), "MMM d, yyyy")}
              <span className="ml-1.5 text-[10px] font-normal text-muted">UTC</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={assigneeFilter}
              aria-label="Filter calendar by technician"
              onChange={(event) => setAssigneeFilter(event.target.value)}
              className="w-full sm:w-[220px]"
            >
              <option value="">All technicians</option>
              {technicianOptions.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {technicians.length > 0 ? (
          <ul className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {technicians.map((technician) => (
              <li key={technician.id} className="flex items-center gap-1.5 text-[10px] text-muted">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: colorForTechnician(technician.id) }}
                  aria-hidden="true"
                />
                {technician.name}
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: colorForTechnician(null) }}
                aria-hidden="true"
              />
              Unassigned
            </li>
          </ul>
        ) : null}
      </Card>

      {unscheduledCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/25 bg-warning/5 px-3 py-2 text-sm">
          <p className="flex items-center gap-2 text-fg">
            <Clock className="size-4 text-warning" aria-hidden="true" />
            <span>
              <span className="num text-warning">{unscheduledCount}</span> unscheduled job
              {unscheduledCount === 1 ? "" : "s"}
              {filterName ? ` for ${filterName}` : ""} not shown on the calendar.
            </span>
          </p>
          <Link
            to="/app/schedule?scope=unscheduled"
            className="text-xs font-medium text-accent hover:underline"
          >
            Schedule them
          </Link>
        </div>
      ) : null}

      {truncated ? (
        <p
          role="status"
          className="rounded-input border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning"
        >
          Showing first {loadedCount} of {total} scheduled jobs this week. Narrow the technician
          filter or open the schedule to see the rest.
        </p>
      ) : null}

      {jobsQuery.isPending ? (
        <CalendarSkeleton />
      ) : jobsQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">Could not load the calendar.</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(jobsQuery.error)}
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => void jobsQuery.refetch()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={
            hasFilters
              ? `No jobs for ${filterName ?? "this technician"} this week.`
              : "Nothing scheduled this week."
          }
          description={
            hasFilters
              ? "Clear the technician filter or move to another week."
              : "Move through the weeks or book a job from the schedule."
          }
          action={
            <Button variant="secondary" onClick={() => setAnchorKey(new Date().toISOString().slice(0, 10))}>
              Go to this week
            </Button>
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[880px]">
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border">
                  <div aria-hidden="true" />
                  {days.map((dayKey) => {
                    const isToday = dayKey === todayKey;
                    return (
                      <div
                        key={dayKey}
                        className={cn(
                          "border-l border-border px-2 py-2 text-center",
                          isToday && "bg-accent/5",
                        )}
                      >
                        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                          {format(dateFromKey(dayKey), "EEE")}
                        </p>
                        <p
                          className={cn(
                            "num mt-0.5 text-sm",
                            isToday ? "text-accent" : "text-fg",
                          )}
                        >
                          {format(dateFromKey(dayKey), "d")}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                  <div className="relative" style={{ height: GRID_HEIGHT }} aria-hidden="true">
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        className={cn(
                          "absolute right-2 text-[10px] text-muted",
                          hour === HOUR_END ? "-translate-y-full" : "-translate-y-1/2",
                        )}
                        style={{ top: (hour - HOUR_START) * HOUR_HEIGHT }}
                      >
                        {`${hour}:00`}
                      </div>
                    ))}
                  </div>
                  {days.map((dayKey, dayIndex) => {
                    const isToday = dayKey === todayKey;
                    return (
                      <div
                        key={dayKey}
                        role="group"
                        aria-label={format(dateFromKey(dayKey), "EEEE, MMMM d")}
                        className={cn("relative border-l border-border", isToday && "bg-accent/[0.03]")}
                        style={{ height: GRID_HEIGHT }}
                      >
                        {HOURS.map((hour) => (
                          <div
                            key={hour}
                            className={cn(
                              "absolute inset-x-0 border-t",
                              hour === HOUR_START ? "border-border/80" : "border-border/50",
                            )}
                            style={{ top: (hour - HOUR_START) * HOUR_HEIGHT }}
                            aria-hidden="true"
                          />
                        ))}
                        {segments
                          .filter((segment) => segment.dayIndex === dayIndex)
                          .map((segment) => {
                            const top = ((segment.startMin - HOUR_START * 60) / 60) * HOUR_HEIGHT;
                            const height = Math.max(
                              MIN_BLOCK_HEIGHT,
                              ((segment.endMin - segment.startMin) / 60) * HOUR_HEIGHT - 2,
                            );
                            const color = colorForTechnician(segment.job.assignee?.id ?? null);
                            return (
                              <button
                                key={`${segment.job.id}-${dayIndex}`}
                                type="button"
                                onClick={() =>
                                  navigate(`/app/schedule?job=${encodeURIComponent(segment.job.id)}`)
                                }
                                title={`${segment.job.number} · ${segment.job.title} · ${segment.job.customer.name} · ${segment.job.location.line1}, ${segment.job.location.city}`}
                                aria-label={`${segment.job.number} ${segment.job.title} for ${segment.job.customer.name}, ${formatTimeRange(segment.job)}, ${segment.job.status}`}
                                className="absolute overflow-hidden rounded-md border border-white/5 px-1.5 py-1 text-left transition-colors hover:border-white/25 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                style={{
                                  top: top + 1,
                                  height,
                                  left: `calc(${(segment.col / segment.cols) * 100}% + 2px)`,
                                  width: `calc(${100 / segment.cols}% - 4px)`,
                                  borderLeft: `3px solid ${color}`,
                                  backgroundColor: `${color}24`,
                                }}
                              >
                                <span className="block truncate text-[11px] font-medium leading-4 text-fg">
                                  {segment.job.title}
                                </span>
                                {height >= 34 ? (
                                  <span className="block truncate text-[10px] leading-4 text-muted">
                                    {formatTimeRange(segment.job)}
                                  </span>
                                ) : null}
                                {height >= 50 ? (
                                  <Badge tone={STATUS_TONE[segment.job.status]} className="mt-1">
                                    {segment.job.status.replaceAll("_", " ")}
                                  </Badge>
                                ) : null}
                              </button>
                            );
                          })}
                        {isToday && showNowLine ? (
                          <div
                            className="pointer-events-none absolute inset-x-0 z-10 border-t border-danger"
                            style={{
                              top: ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT,
                            }}
                          >
                            <span className="absolute -left-1 -top-1.5 size-2.5 rounded-full bg-danger" />
                            <span className="sr-only">Current time</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {outOfHours > 0 ? (
            <p className="text-xs text-muted">
              {outOfHours} job{outOfHours === 1 ? "" : "s"} start outside the 7:00–19:00 grid and
              are clipped.
            </p>
          ) : null}

          <div className="space-y-3 lg:hidden">
            <h2 className="text-sm font-medium text-fg">Day agenda</h2>
            {agendaDays.map(({ dayKey, jobs: dayJobs }) => {
              if (dayJobs.length === 0) return null;
              return (
                <Card key={dayKey} className="p-3">
                  <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
                    <p className="text-sm font-medium text-fg">
                      {format(dateFromKey(dayKey), "EEEE, MMM d")}
                    </p>
                    <span className="num text-[10px] text-muted">
                      {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {dayJobs.map((job) => {
                      const color = colorForTechnician(job.assignee?.id ?? null);
                      return (
                        <li key={job.id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/app/schedule?job=${encodeURIComponent(job.id)}`)}
                            className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          >
                            <span
                              className="h-8 w-1 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <span className="w-20 shrink-0">
                              <span className="num block text-[11px] text-fg">
                                {job.scheduledStart
                                  ? UTC_TIME.format(new Date(job.scheduledStart))
                                  : "Unscheduled"}
                              </span>
                              <span className="block text-[10px] text-muted">
                                {job.durationMinutes} min
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-fg">
                                {job.title}
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {job.customer.name} · {job.location.label}
                              </span>
                            </span>
                            <Badge tone={STATUS_TONE[job.status]}>{job.status.replaceAll("_", " ")}</Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <Card className="space-y-3 p-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, day) => (
          <Skeleton key={day} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </Card>
  );
}
