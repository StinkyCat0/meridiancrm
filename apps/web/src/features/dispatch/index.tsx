import { api, type Job } from "@meridian/api-client";
import {
  JOB_PRIORITY_META,
  type DispatchRoute,
  type DispatchStop,
  type DispatchTechnician,
} from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  LoaderCircle,
  MapPin,
  Route as RouteIcon,
  UserRoundX,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatDate, formatMoney } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { JobStatusBadge, useMembers } from "../operations/shared";
import { DISPATCH_STATUS_LEGEND, DispatchMapView } from "./DispatchMap";

const UTC_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatTimeRange(
  start: string | null,
  end: string | null,
  durationMinutes: number,
): string {
  if (!start) return "Unscheduled";
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return "Unscheduled";
  const parsedEnd = end ? new Date(end) : null;
  const endDate =
    parsedEnd && !Number.isNaN(parsedEnd.getTime())
      ? parsedEnd
      : new Date(startDate.getTime() + durationMinutes * 60_000);
  return `${UTC_TIME.format(startDate)} – ${UTC_TIME.format(endDate)}`;
}

function formatDriveTime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Calendar dates for dispatch are UTC days, matching the API's day windows. */
function shiftDayKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string): Date {
  const parts = key.slice(0, 10).split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

function stopStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function DispatchPage() {
  const queryClient = useQueryClient();
  const membersQuery = useMembers();
  const members = membersQuery.data ?? [];

  const [dateKey, setDateKey] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assignChoice, setAssignChoice] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [routeAssigneeId, setRouteAssigneeId] = useState<string | null>(null);

  const query = { date: dateKey, assigneeId: assigneeFilter || undefined };

  const boardQuery = useQuery({
    queryKey: queryKeys.dispatch.board({ date: dateKey }),
    queryFn: () => api.dispatch.board({ date: dateKey }),
  });

  const mapQuery = useQuery({
    queryKey: queryKeys.dispatch.map(query),
    queryFn: () => api.dispatch.map(query),
  });

  const board = boardQuery.data;
  const stats = board?.stats;
  const isToday = dateKey === new Date().toISOString().slice(0, 10);

  const lanes = useMemo(() => {
    if (!board) return [];
    return assigneeFilter
      ? board.technicians.filter(
          (technician) => technician.user.id === assigneeFilter,
        )
      : board.technicians;
  }, [board, assigneeFilter]);

  const totalJobs = useMemo(() => {
    if (!board) return 0;
    return (
      board.technicians.reduce(
        (count, technician) => count + technician.jobs.length,
        0,
      ) + board.unassigned.length
    );
  }, [board]);

  const technicianOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.user.id, member.user.name);
    for (const lane of board?.technicians ?? [])
      map.set(lane.user.id, lane.user.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [members, board]);

  useEffect(() => {
    setSelected(new Set());
    setAssignError(null);
  }, [dateKey, assigneeFilter]);

  function toggleSelected(jobId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  const assignMutation = useMutation({
    mutationFn: (input: { jobIds: string[]; assigneeId: string | null }) =>
      api.dispatch.assign(input.jobIds, input.assigneeId),
    onSuccess: (result, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dispatch.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.team.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ops.summary() });
      const name = technicianOptions.find(
        (option) => option.id === input.assigneeId,
      )?.name;
      toast.success(
        input.assigneeId
          ? `${result.updated} job${result.updated === 1 ? "" : "s"} assigned${name ? ` to ${name}` : ""}`
          : `${result.updated} job${result.updated === 1 ? "" : "s"} unassigned`,
      );
      setSelected(new Set());
      setAssignError(null);
    },
    onError: (error) => {
      const message = apiErrorMessage(error);
      setAssignError(message);
      toast.error(message);
    },
  });

  function runAssign(assigneeId: string | null) {
    if (selected.size === 0) return;
    setAssignError(null);
    assignMutation.mutate({ jobIds: Array.from(selected), assigneeId });
  }

  function changeDay(days: number) {
    setDateKey((current) => shiftDayKey(current, days));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="FIELD OPERATIONS"
        title="Dispatch"
        description="Plan the day, balance the crew and route every stop without leaving the board."
      />

      <Card className="p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Previous day"
                onClick={() => changeDay(-1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setDateKey(new Date().toISOString().slice(0, 10))
                }
                disabled={isToday}
              >
                Today
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Next day"
                onClick={() => changeDay(1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <Input
              type="date"
              value={dateKey}
              aria-label="Dispatch date"
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDateKey(value);
              }}
              className="w-[150px]"
            />
            <p className="text-sm font-medium text-fg">
              {formatDate(dateFromKey(dateKey), "EEEE, MMM d")}
              <span className="ml-1.5 text-[10px] font-normal text-muted">
                UTC
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={assigneeFilter}
              aria-label="Filter board by technician"
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
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Jobs"
          value={stats ? stats.total : "—"}
          hint={
            board ? formatDate(dateFromKey(board.date), "MMM d") : undefined
          }
          icon={<ClipboardList />}
        />
        <StatCard
          label="Unassigned"
          value={stats ? stats.unassigned : "—"}
          hint="Waiting for a technician"
          icon={<UserRoundX />}
        />
        <StatCard
          label="In progress"
          value={stats ? stats.inProgress : "—"}
          hint="On site now"
          icon={<LoaderCircle />}
        />
        <StatCard
          label="Completed"
          value={stats ? stats.completed : "—"}
          hint="Closed today"
          icon={<CheckCircle2 />}
        />
      </div>

      <Card className="p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-fg">Field map</p>
            <p className="text-xs text-muted">
              {mapQuery.data
                ? `${mapQuery.data.stops.length} stop${mapQuery.data.stops.length === 1 ? "" : "s"} mapped`
                : "Loading stops"}
            </p>
          </div>
          <ul className="flex flex-wrap items-center gap-2.5">
            {DISPATCH_STATUS_LEGEND.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-1 text-[10px] text-muted"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        {mapQuery.isPending ? (
          <Skeleton className="h-[320px] w-full sm:h-[420px]" />
        ) : mapQuery.isError ? (
          <div className="flex h-[320px] flex-col items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center sm:h-[420px]">
            <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-fg">
              Could not load the map.
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted">
              {apiErrorMessage(mapQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void mapQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : mapQuery.data ? (
          <>
            <DispatchMapView
              stops={mapQuery.data.stops}
              depot={mapQuery.data.depot}
              center={mapQuery.data.center}
            />
            <p className="mt-2 text-xs text-muted">
              {mapQuery.data.missingLocationCount > 0
                ? `${mapQuery.data.missingLocationCount} job${
                    mapQuery.data.missingLocationCount === 1 ? "" : "s"
                  } without coordinates — still listed on the board.`
                : "Every job for this day has coordinates."}
            </p>
            <ul className="sr-only">
              {mapQuery.data.stops.map((stop: DispatchStop) => (
                <li key={stop.jobId}>
                  {stop.number}, {stop.title}, {stop.customerName},{" "}
                  {stop.address}, {stopStatusLabel(stop.status)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      {selected.size > 0 ? (
        <Card className="flex flex-col gap-3 border-accent/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg" aria-live="polite">
            <span className="num text-accent">{selected.size}</span> job
            {selected.size === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={assignChoice}
              aria-label="Technician to assign selected jobs"
              onChange={(event) => {
                setAssignChoice(event.target.value);
                setAssignError(null);
              }}
              className="w-full sm:w-[200px]"
            >
              <option value="">Choose technician</option>
              {technicianOptions.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              disabled={!assignChoice || assignMutation.isPending}
              loading={assignMutation.isPending}
              onClick={() => runAssign(assignChoice)}
            >
              Assign
            </Button>
            <Button
              variant="secondary"
              disabled={assignMutation.isPending}
              onClick={() => runAssign(null)}
            >
              Unassign
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(new Set());
                setAssignError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </Card>
      ) : null}

      {assignError ? (
        <p
          role="alert"
          className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {assignError}
        </p>
      ) : null}

      {boardQuery.isPending ? (
        <BoardSkeleton />
      ) : boardQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">
              Could not load the dispatch board.
            </p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(boardQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void boardQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : board ? (
        totalJobs === 0 ? (
          <EmptyState
            icon={<Clock />}
            title={`Nothing scheduled for ${formatDate(dateFromKey(board.date), "EEEE, MMM d")}.`}
            description="Pick another day or open the schedule to book a job."
            action={
              <Button
                variant="secondary"
                onClick={() =>
                  setDateKey(new Date().toISOString().slice(0, 10))
                }
              >
                Go to today
              </Button>
            }
          />
        ) : (
          <div
            className="flex snap-x gap-3 overflow-x-auto pb-2"
            role="region"
            aria-label="Dispatch board"
          >
            <DispatchLane
              title="Unassigned"
              subtitle={`${board.unassigned.length} waiting`}
              icon={<UserRoundX className="size-4" aria-hidden="true" />}
              jobs={board.unassigned}
              selected={selected}
              onToggle={toggleSelected}
              onOpen={setDetailJob}
            />
            {lanes.map((technician) => (
              <TechnicianLane
                key={technician.user.id}
                technician={technician}
                selected={selected}
                onToggle={toggleSelected}
                onOpen={setDetailJob}
                onRoute={() => setRouteAssigneeId(technician.user.id)}
              />
            ))}
          </div>
        )
      ) : null}

      {detailJob ? (
        <JobQuickDetail job={detailJob} onClose={() => setDetailJob(null)} />
      ) : null}

      {routeAssigneeId ? (
        <RouteModal
          dateKey={dateKey}
          assigneeId={routeAssigneeId}
          onClose={() => setRouteAssigneeId(null)}
        />
      ) : null}

      <span className="sr-only" aria-live="polite">
        {membersQuery.isError ? "Technician list unavailable" : ""}
      </span>
    </div>
  );
}

interface DispatchLaneProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  jobs: Job[];
  selected: ReadonlySet<string>;
  onToggle: (jobId: string) => void;
  onOpen: (job: Job) => void;
}

function DispatchLane({
  title,
  subtitle,
  icon,
  jobs,
  selected,
  onToggle,
  onOpen,
}: DispatchLaneProps) {
  return (
    <section
      aria-label={title}
      className="flex w-[280px] shrink-0 snap-start flex-col rounded-card border border-warning/25 bg-surface sm:w-[300px]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{title}</p>
            <p className="truncate text-xs text-muted">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex max-h-[540px] flex-1 flex-col gap-2 overflow-y-auto p-2">
        {jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">
            Everything is assigned.
          </p>
        ) : (
          jobs.map((job) => (
            <DispatchJobCard
              key={job.id}
              job={job}
              selected={selected.has(job.id)}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TechnicianLane({
  technician,
  selected,
  onToggle,
  onOpen,
  onRoute,
}: {
  technician: DispatchTechnician;
  selected: ReadonlySet<string>;
  onToggle: (jobId: string) => void;
  onOpen: (job: Job) => void;
  onRoute: () => void;
}) {
  const hours = Math.round((technician.scheduledMinutes / 60) * 10) / 10;
  const utilization = Math.min(
    100,
    Math.max(0, Math.round(technician.utilizationPct)),
  );
  return (
    <section
      aria-label={technician.user.name}
      className="flex w-[280px] shrink-0 snap-start flex-col rounded-card border border-border bg-surface sm:w-[300px]"
    >
      <div className="border-b border-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar
              name={technician.user.name}
              src={technician.user.avatarUrl}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">
                {technician.user.name}
              </p>
              <p className="truncate text-xs text-muted">
                {technician.jobCount} job{technician.jobCount === 1 ? "" : "s"}{" "}
                · {hours}h booked
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            disabled={technician.jobCount === 0}
            aria-label={`Optimize route for ${technician.user.name}`}
            onClick={onRoute}
          >
            <RouteIcon className="size-3.5" aria-hidden="true" />
            Route
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${utilization}%` }}
              aria-hidden="true"
            />
          </div>
          <span className="num text-[10px] text-muted">{utilization}%</span>
        </div>
      </div>
      <div className="flex max-h-[540px] flex-1 flex-col gap-2 overflow-y-auto p-2">
        {technician.jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">
            No jobs in this lane.
          </p>
        ) : (
          technician.jobs.map((job) => (
            <DispatchJobCard
              key={job.id}
              job={job}
              selected={selected.has(job.id)}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DispatchJobCard({
  job,
  selected,
  onToggle,
  onOpen,
}: {
  job: Job;
  selected: boolean;
  onToggle: (jobId: string) => void;
  onOpen: (job: Job) => void;
}) {
  const priority = JOB_PRIORITY_META[job.priority];
  return (
    <div
      className={cn(
        "relative rounded-input border bg-surface-2/70 transition-colors",
        selected
          ? "border-accent/60 ring-1 ring-accent/30"
          : "border-border hover:border-white/15",
      )}
    >
      <label className="absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full hover:bg-white/5">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${job.number}`}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggle(job.id)}
          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
        />
      </label>
      <button
        type="button"
        onClick={() => onOpen(job)}
        className="block w-full rounded-input p-3 pr-9 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Open ${job.number} ${job.title}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="num text-[11px] text-accent">{job.number}</span>
          <span className="num text-[11px] text-muted">
            {formatTimeRange(
              job.scheduledStart,
              job.scheduledEnd,
              job.durationMinutes,
            )}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-fg">
          {job.customer.name}
        </p>
        <p className="mt-0.5 flex items-start gap-1 text-xs text-muted">
          <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">
            {job.location.line1}, {job.location.city}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <JobStatusBadge status={job.status} />
          <Badge tone={priority.tone}>{priority.label}</Badge>
        </div>
      </button>
    </div>
  );
}

function JobQuickDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  const navigate = useNavigate();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const priority = JOB_PRIORITY_META[job.priority];

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`${job.number} · ${job.title}`}
      description={job.customer.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              navigate(`/app/schedule?job=${encodeURIComponent(job.id)}`)
            }
          >
            Open in schedule
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <JobStatusBadge status={job.status} />
          <Badge tone={priority.tone}>{priority.label} priority</Badge>
        </div>
        <dl className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">Time</dt>
            <dd className="num text-right text-fg">
              {formatTimeRange(
                job.scheduledStart,
                job.scheduledEnd,
                job.durationMinutes,
              )}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">Address</dt>
            <dd className="max-w-[65%] text-right text-fg">
              {job.location.label}
              <span className="block text-xs text-muted">
                {job.location.line1}, {job.location.city}
                {job.location.state ? `, ${job.location.state}` : ""}
              </span>
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">Technician</dt>
            <dd className="text-right text-fg">
              {job.assignee?.name ?? "Unassigned"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">Total</dt>
            <dd className="num text-right text-fg">
              {formatMoney(job.total, currency)}
            </dd>
          </div>
        </dl>
        {job.notes ? (
          <p className="rounded-input bg-white/5 p-2 text-xs text-muted">
            {job.notes}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function RouteModal({
  dateKey,
  assigneeId,
  onClose,
}: {
  dateKey: string;
  assigneeId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const routeQuery = useQuery({
    queryKey: queryKeys.dispatch.route({ date: dateKey, assigneeId }),
    queryFn: () => api.dispatch.route({ date: dateKey, assigneeId }),
    retry: false,
  });

  const route: DispatchRoute | undefined = routeQuery.data;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Optimized route"
      description={
        route
          ? `${route.assignee.name} · ${formatDate(dateFromKey(route.date), "EEE, MMM d")}`
          : "Building the ordered stop list"
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {routeQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : routeQuery.isError ? (
        <div className="rounded-card border border-danger/25 bg-danger/5 p-4 text-center">
          <p className="text-sm text-fg">Could not build a route.</p>
          <p className="mt-1 text-xs text-muted">
            {apiErrorMessage(routeQuery.error)}
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void routeQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : route ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 rounded-card border border-border bg-surface-2/60 p-3 text-center">
            <div>
              <p className="label-micro">Stops</p>
              <p className="num mt-1 text-lg text-fg">{route.stops.length}</p>
            </div>
            <div>
              <p className="label-micro">Distance</p>
              <p className="num mt-1 text-lg text-fg">
                {formatDistance(route.totalDistanceMeters)}
              </p>
            </div>
            <div>
              <p className="label-micro">Drive time</p>
              <p className="num mt-1 text-lg text-fg">
                {formatDriveTime(route.totalDurationMinutes)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {route.optimized
                ? "Ordered to minimize drive time."
                : "Following the scheduled order."}
            </p>
            <Badge tone={route.optimized ? "accent" : "neutral"}>
              {route.optimized ? "Optimized" : "Schedule order"}
            </Badge>
          </div>
          {route.stops.length === 0 ? (
            <EmptyState
              icon={<RouteIcon />}
              title="No stops to route."
              description="Jobs need coordinates before they can be ordered."
            />
          ) : (
            <ol className="max-h-[360px] space-y-2 overflow-y-auto">
              {route.stops.map((stop: DispatchStop, index) => (
                <li key={stop.jobId}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/app/schedule?job=${encodeURIComponent(stop.jobId)}`,
                      )
                    }
                    className="flex w-full items-center gap-3 rounded-input border border-border bg-surface-2/50 p-2.5 text-left transition-colors hover:border-white/15 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="num flex size-6 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-[11px] text-accent">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {stop.title}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {stop.customerName} · {stop.address}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[11px] text-muted">
                      {stop.scheduledStart
                        ? UTC_TIME.format(new Date(stop.scheduledStart))
                        : stopStatusLabel(stop.status)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 3 }, (_, lane) => (
        <div
          key={lane}
          className="w-[280px] shrink-0 rounded-card border border-border bg-surface p-3 sm:w-[300px]"
        >
          <Skeleton className="h-8 w-40" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
