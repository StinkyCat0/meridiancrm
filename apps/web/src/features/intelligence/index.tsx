import {
  api,
  type AssistantBrief,
  type IntelligenceSummary,
  type Recommendation,
} from "@meridian/api-client";
import {
  RECOMMENDATION_KINDS,
  RECOMMENDATION_SEVERITIES,
  type RecommendationKind,
  type RecommendationSeverity,
} from "@meridian/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CircleDollarSign,
  Clock,
  Cpu,
  FileWarning,
  Gauge,
  Lightbulb,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatMoney, relativeTime } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";

const KIND_LABEL: Record<RecommendationKind, string> = {
  CHURN_RISK: "Churn risk",
  NO_SHOW_RISK: "No-show risk",
  UPSELL: "Upsell",
  COLLECTIONS: "Collections",
  REVIEW_REQUEST: "Review request",
  STAFFING: "Staffing",
  REVENUE_FORECAST: "Revenue forecast",
  QUOTE_FOLLOW_UP: "Quote follow-up",
  ROUTE: "Route",
};

const SEVERITY_META: Record<
  RecommendationSeverity,
  { label: string; tone: BadgeTone; order: number }
> = {
  HIGH: { label: "High", tone: "danger", order: 0 },
  MEDIUM: { label: "Medium", tone: "warning", order: 1 },
  INFO: { label: "Info", tone: "accent", order: 2 },
};

const HEALTH_ITEMS = [
  { key: "churnRiskCustomers", label: "Churn risk customers", icon: Users, money: false },
  { key: "noShowRiskJobs", label: "No-show risk jobs", icon: Clock, money: false },
  { key: "overdueAmount", label: "Overdue balance", icon: Receipt, money: true },
  { key: "unassignedToday", label: "Unassigned today", icon: Users, money: false },
  { key: "unbilledJobs", label: "Unbilled jobs", icon: FileWarning, money: false },
  { key: "staleQuotes", label: "Stale quotes", icon: Gauge, money: false },
] as const satisfies ReadonlyArray<{
  key: keyof IntelligenceSummary["health"];
  label: string;
  icon: LucideIcon;
  money: boolean;
}>;

function ConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const tone: BadgeTone =
    confidence === "high" ? "success" : confidence === "medium" ? "warning" : "neutral";
  return <Badge tone={tone}>{confidence} confidence</Badge>;
}

function ForecastCard({ summary, currency }: { summary: IntelligenceSummary; currency: string }) {
  const { forecast } = summary;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" aria-hidden="true" />
            Next 30 days
          </CardTitle>
          <CardDescription className="mt-1">
            Scheduled work, weighted pipeline and recurring plans.
          </CardDescription>
        </div>
        <ConfidenceBadge confidence={forecast.confidence} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="num text-3xl font-light tracking-tight text-fg">
            {formatMoney(forecast.next30Days, currency)}
          </p>
          <p className="mt-1 text-xs text-muted">Projected revenue, next 30 days</p>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: "Scheduled", value: forecast.scheduled },
            { label: "Pipeline weighted", value: forecast.pipelineWeighted },
            { label: "Recurring", value: forecast.recurring },
          ].map((item) => (
            <div key={item.label} className="rounded-input border border-border bg-surface-2/50 p-3">
              <dt className="label-micro">{item.label}</dt>
              <dd className="num mt-1 text-sm text-fg">
                {formatMoney(item.value, currency)}
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="label-micro mb-2">Assumptions</p>
          {forecast.assumptions.length === 0 ? (
            <p className="text-xs text-muted">No assumptions recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {forecast.assumptions.map((assumption, index) => (
                <li key={index} className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  {assumption}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthStrip({ summary, currency }: { summary: IntelligenceSummary; currency: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <p className="label-micro">Health signals</p>
        <span className="text-[10px] text-muted">Live workspace checks</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {HEALTH_ITEMS.map((item) => {
          const Icon = item.icon;
          const raw = summary.health[item.key];
          const value = item.money ? formatMoney(raw, currency) : String(raw);
          const alerting = raw > 0;
          return (
            <div
              key={item.key}
              className={cn(
                "rounded-input border p-3",
                alerting ? "border-warning/25 bg-warning/5" : "border-border bg-surface-2/40",
              )}
            >
              <div className="flex items-center gap-1.5 text-muted">
                <Icon className="size-3.5" aria-hidden="true" />
                <p className="text-[10px] font-medium uppercase tracking-[0.12em]">{item.label}</p>
              </div>
              <p
                className={cn(
                  "num mt-1.5 text-lg font-light tracking-tight",
                  alerting ? "text-warning" : "text-fg",
                )}
              >
                {value}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BriefCard({ brief, error }: { brief: AssistantBrief | undefined; error: unknown }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent-2" aria-hidden="true" />
            Daily brief
          </CardTitle>
          <CardDescription className="mt-1">
            A plain-language summary from the local rules engine.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted">The brief is unavailable right now.</p>
        ) : !brief ? (
          <div className="space-y-2" role="status" aria-label="Loading brief">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-fg">{brief.headline}</p>
            {brief.summary ? (
              <p className="text-sm leading-relaxed text-muted">{brief.summary}</p>
            ) : null}
            {brief.bullets.length > 0 ? (
              <ul className="space-y-1.5">
                {brief.bullets.map((bullet, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-xs leading-relaxed text-fg/80"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent-2" aria-hidden="true" />
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationCard({
  recommendation,
  currency,
}: {
  recommendation: Recommendation;
  currency: string;
}) {
  const severity = SEVERITY_META[recommendation.severity];
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={severity.tone}>{severity.label}</Badge>
            <Badge tone="neutral">{KIND_LABEL[recommendation.kind]}</Badge>
            {recommendation.value !== null ? (
              <span className="num text-xs text-fg">
                {formatMoney(recommendation.value, currency)}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-medium text-fg">{recommendation.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{recommendation.detail}</p>
        </div>
        <span className="shrink-0 text-[10px] text-muted">
          {relativeTime(recommendation.createdAt)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        <span className="font-medium text-fg/80">Why: </span>
        {recommendation.rationale}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {recommendation.customer ? (
          <span className="text-xs text-muted">{recommendation.customer.name}</span>
        ) : null}
        {recommendation.jobNumber ? (
          <span className="text-xs text-muted">Job {recommendation.jobNumber}</span>
        ) : null}
        {recommendation.serviceName ? (
          <span className="text-xs text-muted">{recommendation.serviceName}</span>
        ) : null}
        <Link
          to={recommendation.href}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Take action
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export default function IntelligencePage() {
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";

  const [kind, setKind] = useState<RecommendationKind | "ALL">("ALL");
  const [severity, setSeverity] = useState<RecommendationSeverity | "ALL">("ALL");

  const summaryQuery = useQuery({
    queryKey: queryKeys.intelligence.summary,
    queryFn: () => api.intelligence.summary(),
  });

  const briefQuery = useQuery({
    queryKey: queryKeys.intelligence.brief,
    queryFn: () => api.intelligence.brief(),
  });

  const summary = summaryQuery.data;
  const refreshing = summaryQuery.isFetching || briefQuery.isFetching;

  const recommendations = summary?.recommendations ?? [];

  const filtered = useMemo(
    () =>
      recommendations.filter(
        (recommendation) =>
          (kind === "ALL" || recommendation.kind === kind) &&
          (severity === "ALL" || recommendation.severity === severity),
      ),
    [recommendations, kind, severity],
  );

  const groups = useMemo(() => {
    const ordered = [...RECOMMENDATION_SEVERITIES].sort(
      (a, b) => SEVERITY_META[a].order - SEVERITY_META[b].order,
    );
    return ordered
      .map((value) => ({
        severity: value,
        items: filtered.filter((recommendation) => recommendation.severity === value),
      }))
      .filter((group) => group.items.length > 0);
  }, [filtered]);

  function refreshAll() {
    void summaryQuery.refetch();
    void briefQuery.refetch();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="SIGNALS"
        title="Intelligence"
        description="Risk, revenue and follow-up signals generated by a local, explainable engine — no external model, every item carries its rationale."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">
              <Cpu className="size-3" aria-hidden="true" />
              Local engine
            </Badge>
            <Button variant="secondary" size="sm" onClick={refreshAll} loading={refreshing}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      />

      {summaryQuery.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading intelligence">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : summaryQuery.isError ? (
        <Card className="p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-fg">Could not load intelligence signals</p>
              <p className="mt-1 text-sm text-muted">{apiErrorMessage(summaryQuery.error)}</p>
              <Button className="mt-4" size="sm" onClick={refreshAll}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      ) : summary ? (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <ForecastCard summary={summary} currency={currency} />
            <BriefCard
              brief={briefQuery.data}
              error={briefQuery.isError ? briefQuery.error : null}
            />
            <Card className="min-w-0">
              <CardHeader className="pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-warning" aria-hidden="true" />
                    Recommendation mix
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Signals by kind for this workspace.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.recommendations.length === 0 ? (
                  <p className="text-sm text-muted">Nothing flagged right now.</p>
                ) : (
                  RECOMMENDATION_KINDS.filter((value) => summary.counts[value] > 0).map((value) => {
                    const count = summary.counts[value];
                    const max = Math.max(...RECOMMENDATION_KINDS.map((item) => summary.counts[item]), 1);
                    return (
                      <div key={value} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-xs text-muted">
                          {KIND_LABEL[value]}
                        </span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <span
                            className="block h-full rounded-full bg-accent/70"
                            style={{ width: `${Math.round((count / max) * 100)}%` }}
                          />
                        </span>
                        <span className="num w-6 text-right text-xs text-fg">{count}</span>
                      </div>
                    );
                  })
                )}
                <p className="pt-2 text-[10px] leading-relaxed text-muted">
                  Generated by a local, explainable rules engine — no external model.
                </p>
              </CardContent>
            </Card>
          </div>

          <HealthStrip summary={summary} currency={currency} />

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="label-micro">Recommendation feed</p>
              <p className="mt-1 text-sm text-muted">
                {filtered.length} of {recommendations.length} signals
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Kind" className="min-w-[180px]">
                <Select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as RecommendationKind | "ALL")}
                >
                  <option value="ALL">All kinds</option>
                  {RECOMMENDATION_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {KIND_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Severity" className="min-w-[150px]">
                <Select
                  value={severity}
                  onChange={(event) =>
                    setSeverity(event.target.value as RecommendationSeverity | "ALL")
                  }
                >
                  <option value="ALL">All severities</option>
                  {RECOMMENDATION_SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {SEVERITY_META[value].label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {recommendations.length === 0 ? (
            <EmptyState
              icon={<Lightbulb aria-hidden="true" />}
              title="No recommendations right now"
              description="The engine found nothing urgent. Health checks, forecasts and new signals refresh as work moves through the workspace."
              action={
                <Button size="sm" onClick={refreshAll} loading={refreshing}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh signals
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<CircleDollarSign aria-hidden="true" />}
              title="No signals match these filters"
              description="Try a different kind or severity to see more of the feed."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setKind("ALL");
                    setSeverity("ALL");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <section
                  key={group.severity}
                  aria-label={`${SEVERITY_META[group.severity].label} severity recommendations`}
                  className="min-w-0"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone={SEVERITY_META[group.severity].tone}>
                      {SEVERITY_META[group.severity].label}
                    </Badge>
                    <span className="text-xs text-muted">
                      {group.items.length} {group.items.length === 1 ? "signal" : "signals"}
                    </span>
                  </div>
                  <Card>
                    <ul className="divide-y divide-border/60">
                      {group.items.map((recommendation) => (
                        <RecommendationCard
                          key={recommendation.id}
                          recommendation={recommendation}
                          currency={currency}
                        />
                      ))}
                    </ul>
                  </Card>
                </section>
              ))}
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted">
            Generated {relativeTime(summary.generatedAt)} · scores and forecasts are computed locally
            from workspace data — no external model is called.
          </p>
        </>
      ) : null}
    </div>
  );
}
