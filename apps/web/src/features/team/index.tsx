import {
  api,
  type TeamPerformance,
  type TeamWorkload,
} from "@meridian/api-client";
import { ROLE_RANK, type Role } from "@meridian/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  CheckCircle2,
  Crown,
  DollarSign,
  Gauge,
  Star,
  Ticket,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { Tabs } from "../../components/ui/Tabs";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatDate, formatMoney } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

type PerformanceMember = TeamPerformance["members"][number];
type WorkloadMember = TeamWorkload["members"][number];

type SortKey =
  | "member"
  | "role"
  | "jobsCompleted"
  | "revenue"
  | "margin"
  | "avgTicket"
  | "utilizationPct"
  | "ratingAvg"
  | "openJobs";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

const RANGE_TABS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

const EMPTY_MEMBERS: PerformanceMember[] = [];
const EMPTY_WORKLOAD_MEMBERS: WorkloadMember[] = [];

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function compareMembers(a: PerformanceMember, b: PerformanceMember, sort: SortState): number {
  const direction = sort.dir === "asc" ? 1 : -1;

  switch (sort.key) {
    case "member":
      return a.user.name.localeCompare(b.user.name) * direction;
    case "role":
      return (ROLE_RANK[a.role] - ROLE_RANK[b.role]) * direction;
    case "ratingAvg": {
      if (a.ratingAvg === null && b.ratingAvg === null) return 0;
      if (a.ratingAvg === null) return 1;
      if (b.ratingAvg === null) return -1;
      return (a.ratingAvg - b.ratingAvg) * direction;
    }
    case "jobsCompleted":
      return (a.jobsCompleted - b.jobsCompleted) * direction;
    case "revenue":
      return (a.revenue - b.revenue) * direction;
    case "margin":
      return (a.margin - b.margin) * direction;
    case "avgTicket":
      return (a.avgTicket - b.avgTicket) * direction;
    case "utilizationPct":
      return (a.utilizationPct - b.utilizationPct) * direction;
    case "openJobs":
      return (a.openJobs - b.openJobs) * direction;
  }
  return 0;
}

function UtilizationBar({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className={cn("flex min-w-[110px] items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-white/5"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            value > 100 ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="num w-10 shrink-0 text-right text-xs text-muted">
        {formatPercent(value)}
      </span>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn("label-micro px-3 py-3", align === "right" && "text-right")}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm uppercase tracking-[0.16em] transition-colors hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          align === "right" && "justify-end",
          active ? "text-fg" : "text-muted",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

function Rating({ member }: { member: PerformanceMember }) {
  if (member.ratingAvg === null) {
    return <span className="text-xs text-muted">No ratings</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm text-fg">
      <Star className="size-3.5 text-warning" aria-hidden="true" />
      <span className="num">{member.ratingAvg.toFixed(1)}</span>
      <span className="text-xs text-muted">({member.ratingCount})</span>
    </span>
  );
}

export default function TeamPage() {
  const { workspace } = useAuth();
  const [days, setDays] = useState<30 | 90>(30);
  const [sort, setSort] = useState<SortState>({ key: "revenue", dir: "desc" });

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime());
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const performanceQuery = useQuery({
    queryKey: queryKeys.team.performance(range),
    queryFn: () => api.team.performance(range),
    placeholderData: keepPreviousData,
  });

  const workloadQuery = useQuery({
    queryKey: queryKeys.team.workload(),
    queryFn: () => api.team.workload(),
  });

  const performance = performanceQuery.data;
  const members = performance?.members ?? EMPTY_MEMBERS;
  const currency = performance?.currency ?? workspace?.currency ?? "USD";

  const sortedMembers = useMemo(() => {
    const list = [...members];
    list.sort((a, b) => {
      const result = compareMembers(a, b, sort);
      return result !== 0 ? result : a.user.name.localeCompare(b.user.name);
    });
    return list;
  }, [members, sort]);

  const topPerformer = useMemo(() => {
    if (members.length === 0) return null;
    return (
      [...members].sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.jobsCompleted - a.jobsCompleted ||
          a.user.name.localeCompare(b.user.name),
      )[0] ?? null
    );
  }, [members]);

  const workload = workloadQuery.data;
  const workloadMembers = workload?.members ?? EMPTY_WORKLOAD_MEMBERS;
  const hasActivity =
    topPerformer !== null && (topPerformer.revenue > 0 || topPerformer.jobsCompleted > 0);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: key === "member" || key === "role" ? "asc" : "desc" };
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Team performance"
        description="Revenue, completion and daily load for every member of the crew."
      />

      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          ariaLabel="Performance range"
          items={RANGE_TABS.map((item) => ({ value: item.value, label: item.label }))}
          value={String(days)}
          onChange={(value) => setDays(value === "90" ? 90 : 30)}
          className="border-0"
        />
        <p className="num px-2 text-xs text-muted">
          {performance
            ? `${formatDate(performance.range.from)} – ${formatDate(performance.range.to)}`
            : "Loading range"}
        </p>
      </Card>

      {performanceQuery.isPending ? (
        <PerformanceSkeleton />
      ) : performanceQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">Could not load team performance.</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(performanceQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void performanceQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : performance ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Completed jobs"
              value={performance.totals.jobsCompleted}
              hint={`${performance.totals.jobsScheduled} scheduled`}
              icon={<CheckCircle2 />}
            />
            <StatCard
              label="Revenue"
              value={formatMoney(performance.totals.revenue, currency)}
              hint={`${formatMoney(performance.totals.margin, currency)} margin`}
              icon={<DollarSign />}
            />
            <StatCard
              label="Average ticket"
              value={formatMoney(performance.totals.avgTicket, currency)}
              hint="Per completed job"
              icon={<Ticket />}
            />
            <StatCard
              label="Utilization"
              value={formatPercent(performance.totals.utilizationPct)}
              hint="Of scheduled capacity"
              icon={<Gauge />}
            />
          </div>

          {hasActivity && topPerformer ? (
            <Card className="relative overflow-hidden p-5">
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/10 via-transparent to-accent-2/10"
                aria-hidden="true"
              />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <Avatar
                    name={topPerformer.user.name}
                    src={topPerformer.user.avatarUrl}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">
                        <Crown className="size-3" aria-hidden="true" />
                        Top performer
                      </Badge>
                      <span className="text-xs text-muted">
                        {topPerformer.revenue > 0 ? "Highest revenue" : "Most completed jobs"}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-lg text-fg">{topPerformer.user.name}</p>
                    <p className="truncate text-xs text-muted">
                      {ROLE_LABEL[topPerformer.role]} · {topPerformer.user.email}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="label-micro">Revenue</dt>
                    <dd className="num mt-0.5 text-sm text-fg">
                      {formatMoney(topPerformer.revenue, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-micro">Completed</dt>
                    <dd className="num mt-0.5 text-sm text-fg">{topPerformer.jobsCompleted}</dd>
                  </div>
                  <div>
                    <dt className="label-micro">Avg ticket</dt>
                    <dd className="num mt-0.5 text-sm text-fg">
                      {formatMoney(topPerformer.avgTicket, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-micro">Rating</dt>
                    <dd className="mt-0.5 text-sm text-fg">
                      <Rating member={topPerformer} />
                    </dd>
                  </div>
                </dl>
              </div>
            </Card>
          ) : (
            <Card className="flex items-center gap-3 p-5">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted [&_svg]:size-4"
                aria-hidden="true"
              >
                <Users />
              </span>
              <div>
                <p className="text-sm font-medium text-fg">No completed work in this period.</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  Completed jobs and revenue will highlight your top performer here.
                </p>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Today&apos;s workload</CardTitle>
                <CardDescription className="mt-1">
                  {workload
                    ? `${formatDate(workload.date)} · ${formatMinutes(
                        workload.totalScheduledMinutes,
                      )} scheduled · ${workload.unassigned} unassigned`
                    : "Jobs, scheduled minutes and next start for each member."}
                </CardDescription>
              </div>
              <Badge tone="neutral">
                {workloadMembers.length} {workloadMembers.length === 1 ? "member" : "members"}
              </Badge>
            </CardHeader>
            <CardContent>
              {workloadQuery.isPending ? (
                <div className="-mx-1 flex gap-3 overflow-hidden">
                  {[0, 1, 2].map((item) => (
                    <Skeleton key={item} className="h-36 min-w-[230px] flex-1" />
                  ))}
                </div>
              ) : workloadQuery.isError ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-sm font-medium text-fg">Could not load today&apos;s workload.</p>
                  <p className="mt-1 text-xs text-muted">
                    {apiErrorMessage(workloadQuery.error)}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => void workloadQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : workloadMembers.length === 0 ? (
                <p className="py-4 text-sm text-muted">No team members to schedule.</p>
              ) : (
                <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                  {workloadMembers.map((member) => (
                    <div
                      key={member.user.id}
                      className="min-w-[230px] flex-1 snap-start rounded-card border border-border bg-surface-2/40 p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={member.user.name}
                          src={member.user.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-fg">{member.user.name}</p>
                          <p className="text-[11px] text-muted">
                            {member.jobCount} {member.jobCount === 1 ? "job" : "jobs"} ·{" "}
                            {formatMinutes(member.scheduledMinutes)}
                          </p>
                        </div>
                      </div>
                      <UtilizationBar
                        value={member.utilizationPct}
                        label={`${member.user.name} today`}
                        className="mt-3"
                      />
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {member.nextStart ? (
                          <span title={formatDate(member.nextStart, "MMM d, yyyy · h:mm a")}>
                            Next at {formatDate(member.nextStart, "h:mm a")}
                          </span>
                        ) : member.jobCount > 0 ? (
                          "No upcoming start today"
                        ) : (
                          "No job scheduled"
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Performance</CardTitle>
                <CardDescription className="mt-1">
                  Sort any column. Utilization compares scheduled time against capacity.
                </CardDescription>
              </div>
              <Badge tone="neutral">
                {members.length} {members.length === 1 ? "member" : "members"}
              </Badge>
            </CardHeader>

            {members.length === 0 ? (
              <CardContent>
                <EmptyState
                  icon={<Users />}
                  title="No team members yet."
                  description="Invite teammates from settings to start tracking performance."
                />
              </CardContent>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-y border-border">
                        <SortHeader label="Member" sortKey="member" sort={sort} onSort={toggleSort} />
                        <SortHeader label="Role" sortKey="role" sort={sort} onSort={toggleSort} />
                        <SortHeader
                          label="Completed"
                          sortKey="jobsCompleted"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortHeader
                          label="Revenue"
                          sortKey="revenue"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortHeader
                          label="Margin"
                          sortKey="margin"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortHeader
                          label="Avg ticket"
                          sortKey="avgTicket"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortHeader
                          label="Utilization"
                          sortKey="utilizationPct"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        <SortHeader
                          label="Rating"
                          sortKey="ratingAvg"
                          sort={sort}
                          onSort={toggleSort}
                        />
                        <SortHeader
                          label="Open jobs"
                          sortKey="openJobs"
                          sort={sort}
                          onSort={toggleSort}
                          align="right"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMembers.map((member) => (
                        <tr
                          key={member.user.id}
                          className="border-b border-border/70 last:border-0"
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar
                                name={member.user.name}
                                src={member.user.avatarUrl}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-fg">{member.user.name}</p>
                                <p className="max-w-[200px] truncate text-xs text-muted">
                                  {member.user.email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={member.role === "MEMBER" ? "neutral" : "accent"}>
                              {ROLE_LABEL[member.role]}
                            </Badge>
                          </td>
                          <td className="num px-3 py-3 text-right text-fg">
                            {member.jobsCompleted}
                            {member.jobsScheduled > 0 && member.jobsCompleted === 0 ? (
                              <p className="text-[11px] font-normal text-muted">
                                {member.jobsScheduled} scheduled
                              </p>
                            ) : null}
                          </td>
                          <td className="num px-3 py-3 text-right text-fg">
                            {formatMoney(member.revenue, currency)}
                          </td>
                          <td className="num px-3 py-3 text-right text-muted">
                            {formatMoney(member.margin, currency)}
                          </td>
                          <td className="num px-3 py-3 text-right text-fg">
                            {formatMoney(member.avgTicket, currency)}
                          </td>
                          <td className="px-3 py-3">
                            <UtilizationBar
                              value={member.utilizationPct}
                              label={`${member.user.name} utilization`}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <Rating member={member} />
                          </td>
                          <td className="num px-3 py-3 text-right text-fg">
                            {member.openJobs}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-4 md:hidden">
                  {sortedMembers.map((member) => (
                    <Card key={member.user.id} className="bg-surface-2/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar
                            name={member.user.name}
                            src={member.user.avatarUrl}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-fg">{member.user.name}</p>
                            <p className="truncate text-xs text-muted">{member.user.email}</p>
                          </div>
                        </div>
                        <Badge tone={member.role === "MEMBER" ? "neutral" : "accent"}>
                          {ROLE_LABEL[member.role]}
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                        <span className="text-muted">
                          {member.jobsCompleted} completed · {member.openJobs} open
                        </span>
                        <Rating member={member} />
                      </div>

                      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
                        <div>
                          <dt className="label-micro">Revenue</dt>
                          <dd className="num mt-0.5 text-sm text-fg">
                            {formatMoney(member.revenue, currency)}
                          </dd>
                        </div>
                        <div>
                          <dt className="label-micro">Margin</dt>
                          <dd className="num mt-0.5 text-sm text-muted">
                            {formatMoney(member.margin, currency)}
                          </dd>
                        </div>
                        <div>
                          <dt className="label-micro">Avg ticket</dt>
                          <dd className="num mt-0.5 text-sm text-fg">
                            {formatMoney(member.avgTicket, currency)}
                          </dd>
                        </div>
                      </dl>

                      <UtilizationBar
                        value={member.utilizationPct}
                        label={`${member.user.name} utilization`}
                        className="mt-3"
                      />

                      {member.jobsCompleted === 0 ? (
                        <p className="mt-2 text-[11px] text-muted">
                          {member.jobsScheduled > 0
                            ? `${member.jobsScheduled} scheduled — no completions in this range yet.`
                            : "No jobs scheduled in this range."}
                        </p>
                      ) : null}
                    </Card>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading team performance">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-32" />
      <Skeleton className="h-44" />
      <Skeleton className="h-72" />
    </div>
  );
}
