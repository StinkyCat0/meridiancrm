import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Target,
  Trophy,
  Wallet,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Activity,
  type DashboardSummary,
  type Deal,
  type OpsSummary,
} from "@meridian/api-client";
import { type StageKind } from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
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
import { StatCard, type StatTrend } from "../../components/ui/StatCard";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatDate, formatMoney, relativeTime } from "../../lib/utils";
import { ActivityMixCard, RevenueChartCard, StageChartCard } from "./charts";
import { monthYearLabel } from "./format";
import { JobStatusBadge } from "../operations/shared";

const PERIODS = [3, 6, 12] as const;
type Period = (typeof PERIODS)[number];

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const STAGE_TONE: Record<StageKind, BadgeTone> = {
  OPEN: "accent",
  WON: "success",
  LOST: "danger",
};

const MOMENTUM_TONE: Record<"hot" | "warm" | "cold", string> = {
  hot: "text-success",
  warm: "text-warning",
  cold: "text-danger",
};

const MOMENTUM_BAR: Record<"hot" | "warm" | "cold", string> = {
  hot: "bg-success",
  warm: "bg-warning",
  cold: "bg-danger",
};

function PeriodSelector({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div
      role="group"
      aria-label="Dashboard period"
      className="inline-flex rounded-input border border-border bg-surface p-0.5"
    >
      {PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={value === period}
          onClick={() => onChange(period)}
          className={cn(
            "h-8 rounded-[8px] px-3 text-xs font-medium transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            value === period
              ? "bg-white/[0.07] text-fg"
              : "text-muted hover:bg-white/[0.04] hover:text-fg",
          )}
        >
          {period}M
        </button>
      ))}
    </div>
  );
}

function DashboardKpis({ summary }: { summary: DashboardSummary }) {
  const current = summary.revenueTrend[summary.revenueTrend.length - 1];
  const previous = summary.revenueTrend[summary.revenueTrend.length - 2];

  let wonTrend: StatTrend | undefined;
  if (current && previous) {
    if (previous.won > 0) {
      wonTrend = { value: Math.round(((current.won - previous.won) / previous.won) * 100) };
    } else if (current.won > 0) {
      wonTrend = { value: 100 };
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Pipeline value"
        value={formatMoney(summary.pipelineValue, summary.currency)}
        hint={`${summary.openDealCount} open ${summary.openDealCount === 1 ? "deal" : "deals"}`}
        icon={<CircleDollarSign aria-hidden="true" />}
      />
      <StatCard
        label="Won this month"
        value={formatMoney(summary.wonValueThisMonth, summary.currency)}
        trend={wonTrend}
        hint={`${summary.wonCountThisMonth} ${
          summary.wonCountThisMonth === 1 ? "deal" : "deals"
        } won`}
        icon={<Trophy aria-hidden="true" />}
      />
      <StatCard
        label="Win rate"
        value={`${summary.winRate}%`}
        hint="Trailing 90 days"
        icon={<Target aria-hidden="true" />}
      />
      <StatCard
        label="Avg deal size"
        value={formatMoney(summary.avgDealSize, summary.currency)}
        hint="Won, trailing 90 days"
        icon={<Wallet aria-hidden="true" />}
      />
    </div>
  );
}

function MomentumStrip({ summary }: { summary: DashboardSummary }) {
  const { hot, warm, cold } = summary.momentum;
  const total = hot + warm + cold;

  return (
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="label-micro">Deal momentum</p>
            <p className="num text-xs text-muted">
              {total} open {total === 1 ? "deal" : "deals"}
            </p>
          </div>
          <div
            role="img"
            aria-label={`${hot} hot, ${warm} warm, ${cold} cold deals`}
            className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/5"
          >
            {hot > 0 ? (
              <span
                className={cn("h-full", MOMENTUM_BAR.hot)}
                style={{ width: `${(hot / total) * 100}%` }}
              />
            ) : null}
            {warm > 0 ? (
              <span
                className={cn("h-full", MOMENTUM_BAR.warm)}
                style={{ width: `${(warm / total) * 100}%` }}
              />
            ) : null}
            {cold > 0 ? (
              <span
                className={cn("h-full", MOMENTUM_BAR.cold)}
                style={{ width: `${(cold / total) * 100}%` }}
              />
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
            {(["hot", "warm", "cold"] as const).map((band) => (
              <span key={band} className="inline-flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", MOMENTUM_BAR[band])} aria-hidden="true" />
                <span className="capitalize text-muted">{band}</span>
                <span className="num font-medium text-fg">{summary.momentum[band]}</span>
              </span>
            ))}
          </div>
        </div>
        <Link
          to="/app/deals?status=open"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-input px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-auto"
        >
          Review pipeline
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

function RecentDealsCard({ deals }: { deals: Deal[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Recent deals</CardTitle>
          <CardDescription className="mt-1">Latest movement across the workspace.</CardDescription>
        </div>
        <Link
          to="/app/deals"
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {deals.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">No deals yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {deals.map((deal) => {
              const contactName = deal.contact
                ? `${deal.contact.firstName} ${deal.contact.lastName}`.trim()
                : null;
              return (
                <li key={deal.id}>
                  <Link
                    to={`/app/deals?deal=${deal.id}`}
                    className="group flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg group-hover:text-accent">
                          {deal.title}
                        </span>
                        <Badge tone={STAGE_TONE[deal.stage.kind]}>{deal.stage.name}</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        {deal.company?.name ?? contactName ?? "Unlinked"}
                        {deal.expectedCloseDate
                          ? ` · closes ${formatDate(deal.expectedCloseDate)}`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-sm font-medium text-fg">
                        {formatMoney(deal.value, deal.currency)}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-[10px] font-black uppercase tracking-[0.16em]",
                          MOMENTUM_TONE[deal.momentum.band],
                        )}
                      >
                        {deal.momentum.band}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TasksDueCard({ tasks }: { tasks: Activity[] }) {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: (id: string) =>
      api.activities.update(id, { completedAt: new Date().toISOString() }),
    onSuccess: () => {
      toast.success("Task completed");
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) => toast.error(messageFor(error, "Could not complete the task.")),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Tasks due</CardTitle>
          <CardDescription className="mt-1">Next seven days and overdue.</CardDescription>
        </div>
        <Link
          to="/app/activities?new=1"
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Log
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {tasks.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">No tasks due this week.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {tasks.map((task) => {
              const overdue = task.dueAt ? new Date(task.dueAt).getTime() < Date.now() : false;
              const pending = complete.isPending && complete.variables === task.id;
              return (
                <li key={task.id} className="flex items-start gap-3 px-5 py-3.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={false}
                    aria-label={`Complete ${task.title}`}
                    disabled={complete.isPending}
                    onClick={() => complete.mutate(task.id)}
                    className="group mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border bg-surface-2 text-transparent transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="size-3 animate-spin text-muted" aria-hidden="true" />
                    ) : (
                      <Check
                        className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/app/activities?activity=${task.id}`}
                      className="block truncate text-sm text-fg transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {task.title}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {task.dealTitle ?? task.company?.name ?? "No linked record"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      title={formatDate(task.dueAt, "MMM d, yyyy · h:mm a")}
                      className={cn("text-[11px]", overdue ? "text-danger" : "text-muted")}
                    >
                      {relativeTime(task.dueAt)}
                    </span>
                    <Avatar name={task.owner?.name ?? "Unassigned"} size="xs" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OpsStrip({ summary }: { summary: OpsSummary }) {
  const metrics = [
    {
      label: "Jobs today",
      value: `${summary.jobsTodayCompleted}/${summary.jobsToday}`,
      hint: "completed on site",
      to: "/app/schedule",
      icon: CalendarDays,
    },
    {
      label: "Booked this week",
      value: formatMoney(summary.bookedWeek, summary.currency),
      hint: "scheduled value",
      to: "/app/schedule",
      icon: ClipboardList,
    },
    {
      label: "Outstanding",
      value: formatMoney(summary.outstanding, summary.currency),
      hint: `${summary.overdueInvoices} overdue ${
        summary.overdueInvoices === 1 ? "invoice" : "invoices"
      }`,
      to: "/app/invoices",
      icon: Wallet,
    },
    {
      label: "Open estimates",
      value: formatMoney(summary.openEstimateValue, summary.currency),
      hint: `${summary.openEstimates} to review`,
      to: "/app/estimates",
      icon: FileText,
    },
    {
      label: "Crew coverage",
      value: summary.jobsUnassigned === 0 ? "Fully staffed" : `${summary.jobsUnassigned} open`,
      hint: `${summary.jobsUnscheduled} unscheduled`,
      to: "/app/schedule?scope=unscheduled",
      icon: Wrench,
    },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <p className="label-micro">Field operations</p>
          <p className="mt-1 text-sm text-fg">
            Today, {formatDate(summary.date, "EEEE, MMMM d")}
          </p>
        </div>
        <Link
          to="/app/schedule"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open dispatch
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5 xl:divide-x">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              to={metric.to}
              className="group flex items-start justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <div className="min-w-0">
                <p className="label-micro">{metric.label}</p>
                <p className="num mt-1 truncate text-lg text-fg">{metric.value}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{metric.hint}</p>
              </div>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2 text-muted transition-colors group-hover:text-accent">
                <Icon className="size-4" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function TodayScheduleCard({ summary }: { summary: OpsSummary }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Today&apos;s route</CardTitle>
          <CardDescription className="mt-1">
            {summary.jobsToday === 0
              ? "No visits on the board for today."
              : `${summary.jobsToday} ${
                  summary.jobsToday === 1 ? "visit" : "visits"
                } on the board.`}
          </CardDescription>
        </div>
        <Link
          to="/app/schedule"
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Schedule
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {summary.today.length === 0 ? (
          <p className="border-t border-border px-5 py-6 text-sm text-muted">
            Nothing scheduled today — a good day to confirm upcoming visits.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {summary.today.map((job) => (
              <li key={job.id}>
                <Link
                  to={`/app/schedule?job=${encodeURIComponent(job.id)}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="num w-16 shrink-0 text-xs text-muted">
                    {job.scheduledStart ? formatDate(job.scheduledStart, "h:mm a") : "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{job.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {job.customer.name} · {job.location.label}
                      {job.assignee ? ` · ${job.assignee.name}` : " · Unassigned"}
                    </span>
                  </span>
                  <JobStatusBadge status={job.status} />
                  <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-24" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-3" />
        <Skeleton className="h-80 lg:col-span-2" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [months, setMonths] = useState<Period>(6);
  const dashboardQuery = useQuery({
    queryKey: queryKeys.insights.dashboard(months),
    queryFn: () => api.insights.dashboard(months),
  });
  const opsQuery = useQuery({
    queryKey: queryKeys.ops.summary(),
    queryFn: () => api.ops.summary(),
  });
  const summary = dashboardQuery.data;
  const ops = opsQuery.data;
  const opsHasWork = Boolean(
    ops &&
      (ops.jobsToday > 0 ||
        ops.recurringJobs > 0 ||
        ops.activeCustomers > 0 ||
        ops.openEstimates > 0),
  );
  const firstMonth = summary?.revenueTrend[0]?.month;
  const lastMonth = summary?.revenueTrend[summary.revenueTrend.length - 1]?.month;
  const rangeLabel =
    firstMonth && lastMonth
      ? `${monthYearLabel(firstMonth)} – ${monthYearLabel(lastMonth)}`
      : `Last ${months} months`;
  const isEmpty =
    summary !== undefined &&
    !opsHasWork &&
    summary.openDealCount === 0 &&
    summary.recentDeals.length === 0 &&
    summary.wonCountThisMonth === 0 &&
    summary.tasksDue.length === 0 &&
    summary.activityMix.every((item) => item.count === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title={`${workspace?.name ?? "Workspace"} overview`}
        description={`${rangeLabel} · a live read on the route, work and cash.`}
        actions={
          <>
            <PeriodSelector value={months} onChange={setMonths} />
            <Button variant="secondary" onClick={() => navigate("/app/estimates?new=1")}>
              <Plus className="size-4" aria-hidden="true" />
              New estimate
            </Button>
            <Button variant="primary" onClick={() => navigate("/app/schedule?new=1")}>
              <Wrench className="size-4" aria-hidden="true" />
              New job
            </Button>
          </>
        }
      />

      {dashboardQuery.isLoading ? <DashboardSkeleton /> : null}

      {ops ? (
        <div className="space-y-4">
          <OpsStrip summary={ops} />
          <TodayScheduleCard summary={ops} />
        </div>
      ) : null}

      {dashboardQuery.isError ? (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <span
              className="mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted"
              aria-hidden="true"
            >
              <RefreshCw className="size-5" />
            </span>
            <p className="text-sm font-medium text-fg">Dashboard unavailable</p>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
              {messageFor(dashboardQuery.error, "We could not load your workspace snapshot.")}
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => void dashboardQuery.refetch()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </Card>
      ) : null}

      {summary && isEmpty ? (
        <EmptyState
          icon={<CircleDollarSign />}
          title="Your workspace is quiet"
          description="Create the first deal to start tracking pipeline value, momentum and revenue."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" onClick={() => navigate("/app/deals?new=1")}>
                <Plus className="size-4" aria-hidden="true" />
                New deal
              </Button>
              <Button variant="secondary" onClick={() => navigate("/app/settings")}>
                Configure workspace
              </Button>
            </div>
          }
        />
      ) : null}

      {summary && !isEmpty ? (
        <>
          <DashboardKpis summary={summary} />
          <MomentumStrip summary={summary} />
          <div className="grid min-w-0 gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <RevenueChartCard summary={summary} />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <StageChartCard summary={summary} />
            </div>
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <RecentDealsCard deals={summary.recentDeals} />
            </div>
            <div className="min-w-0 space-y-4">
              <TasksDueCard tasks={summary.tasksDue} />
              <ActivityMixCard summary={summary} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
