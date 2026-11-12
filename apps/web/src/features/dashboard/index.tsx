import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  ClipboardList,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  Wallet,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Activity,
  type CommunicationStats,
  type DashboardSummary,
  type Deal,
  type DispatchBoard,
  type FinanceSummary,
  type IntelligenceSummary,
  type OpsSummary,
  type Recommendation,
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
import { compactMoney, monthLabel, monthYearLabel } from "./format";
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

function SectionError({
  title,
  error,
  onRetry,
  className,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
          <AlertTriangle className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {messageFor(error, "This section could not load. Try again.")}
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ServiceKpis({
  ops,
  finance,
  board,
}: {
  ops: OpsSummary;
  finance: FinanceSummary;
  board: DispatchBoard;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Jobs today"
        value={ops.jobsToday}
        hint={`${ops.jobsTodayCompleted} complete · ${board.stats.inProgress} in progress`}
        icon={<CalendarDays aria-hidden="true" />}
      />
      <StatCard
        label="Unassigned"
        value={board.stats.unassigned}
        hint={`${ops.jobsUnscheduled} unscheduled`}
        icon={<Wrench aria-hidden="true" />}
      />
      <StatCard
        label="Collected"
        value={formatMoney(finance.collected, finance.currency)}
        hint={`${finance.paymentCount} ${
          finance.paymentCount === 1 ? "payment" : "payments"
        } recorded`}
        icon={<Wallet aria-hidden="true" />}
      />
      <StatCard
        label="Receivables"
        value={formatMoney(finance.outstanding, finance.currency)}
        hint={`${formatMoney(finance.overdueAmount, finance.currency)} overdue`}
        icon={<ClipboardList aria-hidden="true" />}
      />
    </div>
  );
}

function ServiceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading service operations">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-3" />
        <Skeleton className="h-80 lg:col-span-2" />
      </div>
    </div>
  );
}

function TodayRouteCard({ board }: { board: DispatchBoard }) {
  const route = [
    ...board.technicians.flatMap((technician) =>
      technician.jobs.map((job) => ({ job, assignee: technician.user.name })),
    ),
    ...board.unassigned.map((job) => ({ job, assignee: null as string | null })),
  ].sort((a, b) => {
    const aTime = a.job.scheduledStart ? new Date(a.job.scheduledStart).getTime() : Infinity;
    const bTime = b.job.scheduledStart ? new Date(b.job.scheduledStart).getTime() : Infinity;
    return aTime - bTime;
  });
  const shown = route.slice(0, 8);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Today&apos;s route</CardTitle>
          <CardDescription className="mt-1">
            {route.length === 0
              ? "No visits on the board for today."
              : `${route.length} ${route.length === 1 ? "visit" : "visits"} · ${
                  board.technicians.length
                } ${board.technicians.length === 1 ? "technician" : "technicians"}`}
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
        {shown.length === 0 ? (
          <p className="border-t border-border px-5 py-6 text-sm text-muted">
            Nothing scheduled today — a good day to confirm upcoming visits.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {shown.map(({ job, assignee }) => (
              <li key={job.id}>
                <Link
                  to={`/app/schedule?job=${encodeURIComponent(job.id)}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="num w-14 shrink-0 text-xs text-muted">
                    {job.scheduledStart ? formatDate(job.scheduledStart, "h:mm a") : "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{job.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {job.customer.name} · {job.location.label}
                      {assignee ? ` · ${assignee}` : " · Unassigned"}
                    </span>
                  </span>
                  <JobStatusBadge status={job.status} />
                  <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {route.length > shown.length ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
            <p className="num text-xs text-muted">
              Showing {shown.length} of {route.length}
            </p>
            <Link
              to="/app/schedule"
              className="text-xs font-medium text-accent transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Full schedule
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const SEVERITY_TONE: Record<Recommendation["severity"], BadgeTone> = {
  INFO: "neutral",
  MEDIUM: "warning",
  HIGH: "danger",
};

function PrioritiesCard({
  summary,
  currency,
}: {
  summary: IntelligenceSummary;
  currency: string;
}) {
  const recommendations = summary.recommendations.slice(0, 5);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            AI priorities
          </CardTitle>
          <CardDescription className="mt-1">
            {summary.recommendations.length === 0
              ? "No recommendations right now."
              : `${summary.recommendations.length} ${
                  summary.recommendations.length === 1 ? "recommendation" : "recommendations"
                } across the book.`}
          </CardDescription>
        </div>
        <Link
          to="/app/intelligence"
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Review
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {recommendations.length === 0 ? (
          <p className="border-t border-border px-5 py-6 text-sm text-muted">
            Nothing urgent — keep confirming tomorrow&apos;s visits.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {recommendations.map((recommendation) => (
              <li key={recommendation.id}>
                <Link
                  to={recommendation.href}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <Badge tone={SEVERITY_TONE[recommendation.severity]}>
                    {recommendation.severity}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {recommendation.title}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-muted">
                      {recommendation.detail}
                    </span>
                  </span>
                  {recommendation.value !== null ? (
                    <span className="num shrink-0 text-xs text-fg">
                      {formatMoney(recommendation.value, currency)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.recommendations.length > recommendations.length ? (
          <div className="border-t border-border px-5 py-3">
            <p className="num text-xs text-muted">
              Showing {recommendations.length} of {summary.recommendations.length}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FollowUpsCard({ stats }: { stats: CommunicationStats }) {
  const metrics = [
    { label: "Follow-ups", value: stats.followUpsOpen },
    { label: "Unread", value: stats.unread },
    { label: "Calls today", value: stats.callsToday },
    { label: "Texts today", value: stats.textsToday },
  ];

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-4 text-accent" aria-hidden="true" />
            Communications
          </CardTitle>
          <CardDescription className="mt-1">
            Follow-ups waiting on the inbox.
          </CardDescription>
        </div>
        <Link
          to="/app/inbox"
          className="shrink-0 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Inbox
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <dl className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border">
          {metrics.map((metric) => (
            <div key={metric.label} className="px-5 py-3.5">
              <dt className="label-micro">{metric.label}</dt>
              <dd className="num mt-1 text-xl text-fg">{metric.value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
          {stats.followUpsOpen === 0
            ? "No follow-ups due. Inbox is clear."
            : `${stats.followUpsOpen} ${
                stats.followUpsOpen === 1 ? "follow-up needs" : "follow-ups need"
              } a reply.`}
        </p>
      </CardContent>
    </Card>
  );
}

function FinanceRevenueCard({ summary }: { summary: FinanceSummary }) {
  const data = summary.monthly.map((month) => ({
    ...month,
    label: monthLabel(month.month),
  }));

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div>
          <CardTitle>Cash collected</CardTitle>
          <CardDescription className="mt-1">
            Monthly revenue against expenses from finance.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10px] font-medium text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
            Revenue
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent-2" aria-hidden="true" />
            Expenses
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            No finance activity in this period.
          </p>
        ) : (
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                />
                <YAxis
                  tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value: number) => compactMoney(value, summary.currency)}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--color-muted)" }}
                  itemStyle={{ color: "var(--color-fg)" }}
                  formatter={(value) => formatMoney(Number(value), summary.currency)}
                />
                <Bar dataKey="revenue" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="var(--color-accent-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading pipeline insights">
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
  const opsQuery = useQuery({
    queryKey: queryKeys.ops.summary(),
    queryFn: () => api.ops.summary(),
  });
  const financeQuery = useQuery({
    queryKey: queryKeys.finance.summary(),
    queryFn: () => api.finance.summary(),
  });
  const dispatchQuery = useQuery({
    queryKey: queryKeys.dispatch.board(),
    queryFn: () => api.dispatch.board(),
  });
  const intelligenceQuery = useQuery({
    queryKey: queryKeys.intelligence.summary,
    queryFn: () => api.intelligence.summary(),
  });
  const communicationsQuery = useQuery({
    queryKey: queryKeys.communications.stats,
    queryFn: () => api.communications.stats(),
  });
  const dashboardQuery = useQuery({
    queryKey: queryKeys.insights.dashboard(months),
    queryFn: () => api.insights.dashboard(months),
  });

  const serviceQueries = [
    opsQuery,
    financeQuery,
    dispatchQuery,
    intelligenceQuery,
    communicationsQuery,
  ];
  const serviceDown = serviceQueries.every((query) => query.isError);
  const servicePending = serviceQueries.some((query) => query.isPending);
  const ops = opsQuery.data;
  const finance = financeQuery.data;
  const board = dispatchQuery.data;
  const intelligence = intelligenceQuery.data;
  const communicationStats = communicationsQuery.data;
  const summary = dashboardQuery.data;

  const firstMonth = summary?.revenueTrend[0]?.month;
  const lastMonth = summary?.revenueTrend[summary.revenueTrend.length - 1]?.month;
  const rangeLabel =
    firstMonth && lastMonth
      ? `${monthYearLabel(firstMonth)} – ${monthYearLabel(lastMonth)}`
      : `Last ${months} months`;
  const isEmpty =
    summary !== undefined &&
    summary.openDealCount === 0 &&
    summary.recentDeals.length === 0 &&
    summary.wonCountThisMonth === 0 &&
    summary.tasksDue.length === 0 &&
    summary.activityMix.every((item) => item.count === 0);

  function retryServices() {
    for (const query of serviceQueries) void query.refetch();
  }

  function retryServiceMetrics() {
    void opsQuery.refetch();
    void financeQuery.refetch();
    void dispatchQuery.refetch();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title={`${workspace?.name ?? "Workspace"} overview`}
        description="Today's route, cash and follow-ups first — pipeline second."
        actions={
          <>
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

      {serviceDown ? (
        <SectionError
          title="Service operations unavailable"
          error={
            opsQuery.error ??
            financeQuery.error ??
            dispatchQuery.error ??
            intelligenceQuery.error ??
            communicationsQuery.error
          }
          onRetry={retryServices}
        />
      ) : servicePending ? (
        <ServiceSkeleton />
      ) : (
        <>
          <section aria-labelledby="service-heading" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="label-micro">Service operations</p>
                <h2 id="service-heading" className="text-lg font-light text-fg">
                  {ops ? formatDate(ops.date, "EEEE, MMMM d") : "Today"}
                </h2>
              </div>
              <Link
                to="/app/schedule"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open dispatch
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {opsQuery.isError || financeQuery.isError || dispatchQuery.isError ? (
              <SectionError
                title="Service metrics unavailable"
                error={opsQuery.error ?? financeQuery.error ?? dispatchQuery.error}
                onRetry={retryServiceMetrics}
              />
            ) : ops && finance && board ? (
              <ServiceKpis ops={ops} finance={finance} board={board} />
            ) : null}
          </section>

          <div className="grid min-w-0 gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              {dispatchQuery.isPending ? (
                <Skeleton className="h-96" />
              ) : dispatchQuery.isError ? (
                <SectionError
                  title="Today's route unavailable"
                  error={dispatchQuery.error}
                  onRetry={() => void dispatchQuery.refetch()}
                />
              ) : board ? (
                <TodayRouteCard board={board} />
              ) : null}
            </div>
            <div className="min-w-0 lg:col-span-2">
              {intelligenceQuery.isPending ? (
                <Skeleton className="h-96" />
              ) : intelligenceQuery.isError ? (
                <SectionError
                  title="AI priorities unavailable"
                  error={intelligenceQuery.error}
                  onRetry={() => void intelligenceQuery.refetch()}
                />
              ) : intelligence ? (
                <PrioritiesCard
                  summary={intelligence}
                  currency={workspace?.currency ?? "USD"}
                />
              ) : null}
            </div>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              {financeQuery.isPending ? (
                <Skeleton className="h-80" />
              ) : financeQuery.isError ? (
                <SectionError
                  title="Finance chart unavailable"
                  error={financeQuery.error}
                  onRetry={() => void financeQuery.refetch()}
                />
              ) : finance ? (
                <FinanceRevenueCard summary={finance} />
              ) : null}
            </div>
            <div className="min-w-0 lg:col-span-2">
              {communicationsQuery.isPending ? (
                <Skeleton className="h-64" />
              ) : communicationsQuery.isError ? (
                <SectionError
                  title="Communications unavailable"
                  error={communicationsQuery.error}
                  onRetry={() => void communicationsQuery.refetch()}
                />
              ) : communicationStats ? (
                <FollowUpsCard stats={communicationStats} />
              ) : null}
            </div>
          </div>
        </>
      )}

      <section aria-labelledby="pipeline-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div>
            <p className="label-micro">Pipeline &amp; deals</p>
            <h2 id="pipeline-heading" className="text-lg font-light text-fg">
              Sales analytics
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {rangeLabel} · secondary view of deal momentum and revenue.
            </p>
          </div>
          <PeriodSelector value={months} onChange={setMonths} />
        </div>

        {dashboardQuery.isPending ? (
          <PipelineSkeleton />
        ) : dashboardQuery.isError ? (
          <SectionError
            title="Pipeline analytics unavailable"
            error={dashboardQuery.error}
            onRetry={() => void dashboardQuery.refetch()}
          />
        ) : summary && isEmpty ? (
          <EmptyState
            icon={<CircleDollarSign />}
            title="Pipeline is quiet"
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
        ) : summary ? (
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
      </section>
    </div>
  );
}
