import type { CSSProperties } from "react";
import {
  CalendarDays,
  CheckSquare2,
  Mail,
  Phone,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ACTIVITY_TYPE_META,
  type ActivityType,
  type DashboardSummary,
  type StageKind,
} from "@meridian/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { cn, formatMoney } from "../../lib/utils";
import { compactMoney, monthLabel } from "./format";

const tooltipContentStyle: CSSProperties = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "10px 12px",
  boxShadow: "var(--shadow-panel)",
  fontSize: 12,
};

const tooltipLabelStyle: CSSProperties = {
  color: "var(--color-muted)",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  marginBottom: 4,
};

const tooltipItemStyle: CSSProperties = {
  color: "var(--color-fg)",
  fontSize: 12,
  padding: 0,
};

const axisTick = { fill: "var(--color-muted)", fontSize: 11 };
const gridStroke = "var(--color-border)";

export function RevenueChartCard({ summary }: { summary: DashboardSummary }) {
  const data = summary.revenueTrend.map((point) => ({
    ...point,
    label: monthLabel(point.month),
  }));

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div>
          <CardTitle>Revenue momentum</CardTitle>
          <CardDescription className="mt-1">Won revenue against newly created deals.</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10px] font-medium text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
            Won
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent-2" aria-hidden="true" />
            Created
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="won-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                dy={6}
              />
              <YAxis
                yAxisId="value"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value: number) => compactMoney(value, summary.currency)}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ stroke: "rgba(255,255,255,0.16)", strokeDasharray: "4 4" }}
                formatter={(value, name) => {
                  const numeric = typeof value === "number" ? value : Number(value);
                  if (name === "Won revenue") {
                    return [formatMoney(numeric, summary.currency), "Won revenue"];
                  }
                  return [`${numeric} ${numeric === 1 ? "deal" : "deals"}`, "New deals"];
                }}
              />
              <Area
                yAxisId="value"
                type="monotone"
                dataKey="won"
                name="Won revenue"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill="url(#won-revenue-fill)"
              />
              <Area
                yAxisId="count"
                type="monotone"
                dataKey="created"
                name="New deals"
                stroke="var(--color-accent-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="transparent"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const STAGE_COLORS: Record<StageKind, string> = {
  OPEN: "var(--color-accent)",
  WON: "var(--color-success)",
  LOST: "var(--color-danger)",
};

export function StageChartCard({ summary }: { summary: DashboardSummary }) {
  const data = summary.stageDistribution.filter((stage) => stage.count > 0);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div>
          <CardTitle>Stage distribution</CardTitle>
          <CardDescription className="mt-1">Open pipeline value by stage.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-input border border-dashed border-border text-sm text-muted">
            No pipeline value yet.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke={gridStroke} horizontal={false} />
                <XAxis
                  type="number"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => compactMoney(value, summary.currency)}
                />
                <YAxis
                  type="category"
                  dataKey="stageName"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={84}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  formatter={(value) => [
                    formatMoney(typeof value === "number" ? value : Number(value), summary.currency),
                    "Pipeline value",
                  ]}
                />
                <Bar dataKey="value" name="Pipeline value" barSize={14} radius={[0, 6, 6, 0]}>
                  {data.map((stage) => (
                    <Cell key={stage.stageId} fill={STAGE_COLORS[stage.kind]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const MIX_ICONS: Record<ActivityType, LucideIcon> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarDays,
  TASK: CheckSquare2,
};

const MIX_BAR_COLORS: Record<ActivityType, string> = {
  NOTE: "bg-accent",
  CALL: "bg-accent-2",
  EMAIL: "bg-success",
  MEETING: "bg-warning",
  TASK: "bg-danger",
};

export function ActivityMixCard({ summary }: { summary: DashboardSummary }) {
  const total = summary.activityMix.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Activity mix</CardTitle>
          <CardDescription className="mt-1">Last 30 days.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No activity logged in the last 30 days.</p>
        ) : (
          summary.activityMix.map((item) => {
            const Icon = MIX_ICONS[item.type];
            const share = Math.round((item.count / total) * 100);
            return (
              <div key={item.type} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-2 text-muted">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{ACTIVITY_TYPE_META[item.type].label}</span>
                  </span>
                  <span className="num shrink-0 text-fg">{item.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-300", MIX_BAR_COLORS[item.type])}
                    style={{ width: `${Math.max(item.count > 0 ? 4 : 0, share)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
