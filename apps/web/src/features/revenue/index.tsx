import {
  api,
  type CreateExpenseInput,
  type Expense,
  type FinanceSummary,
} from "@meridian/api-client";
import {
  atLeast,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_META,
  PAYMENT_METHOD_LABEL,
  type ExpenseCategory,
} from "@meridian/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeDollarSign,
  Banknote,
  Download,
  Plus,
  Receipt,
  RefreshCw,
  TrendingUp,
  Trash2,
  Wallet,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
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
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import {
  cn,
  downloadCsv,
  formatDate,
  formatMoney,
  fromCents,
  toCents,
} from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { compactMoney, monthYearLabel } from "../dashboard/format";
import { fromDateInput, toDateInput } from "../operations/shared";

const PERIODS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "custom", label: "Custom" },
] as const;

type PeriodValue = (typeof PERIODS)[number]["value"];

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function percentOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}%`
    : "—";
}

const tooltipContentStyle = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "10px 12px",
  boxShadow: "var(--shadow-panel)",
  fontSize: 12,
} as const;

const tooltipLabelStyle = {
  color: "var(--color-muted)",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  marginBottom: 4,
} as const;

const axisTick = { fill: "var(--color-muted)", fontSize: 11 };

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Revenue period"
      className="inline-flex flex-wrap rounded-input border border-border bg-surface p-0.5"
    >
      {PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          aria-pressed={value === period.value}
          onClick={() => onChange(period.value)}
          className={cn(
            "h-8 rounded-[8px] px-3 text-xs font-medium transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            value === period.value
              ? "bg-white/[0.07] text-fg"
              : "text-muted hover:bg-white/[0.04] hover:text-fg",
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function FinanceTrendChart({ summary }: { summary: FinanceSummary }) {
  const data = summary.monthly.map((month) => ({
    ...month,
    label: monthYearLabel(month.month),
  }));

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div>
          <CardTitle>Revenue &amp; margin</CardTitle>
          <CardDescription className="mt-1">
            Collected revenue, expenses and gross profit by month.
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-[10px] font-medium text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-accent"
              aria-hidden="true"
            />
            Revenue
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-danger"
              aria-hidden="true"
            />
            Expenses
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full bg-accent-2"
              aria-hidden="true"
            />
            Profit
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {data.length === 0 ? (
          <EmptyState
            icon={<TrendingUp aria-hidden="true" />}
            title="No revenue in this period"
            description="Collected payments and recorded expenses will appear here once the period has activity."
            className="py-10"
          />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(value: number) =>
                    compactMoney(value, summary.currency)
                  }
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={{
                    color: "var(--color-fg)",
                    fontSize: 12,
                    padding: 0,
                  }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  formatter={(value, name) => [
                    formatMoney(Number(value), summary.currency),
                    String(name),
                  ]}
                />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="var(--color-accent)"
                  fillOpacity={0.8}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses"
                  fill="var(--color-danger)"
                  fillOpacity={0.55}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Profit"
                  stroke="var(--color-accent-2)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="pb-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription className="mt-1">{description}</CardDescription>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function TableScroll({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="w-full min-w-[560px] border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "label-micro whitespace-nowrap border-b border-border px-5 py-2.5",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border/60 px-5 py-2.5 align-middle text-fg/90",
        align === "right" ? "num text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

function TableEmpty({ message }: { message: string }) {
  return (
    <p className="px-5 py-8 text-center text-sm text-muted" role="status">
      {message}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Expense form                                                               */
/* -------------------------------------------------------------------------- */

interface ExpenseFormModalProps {
  expense: Expense | null;
  currency: string;
  onClose: () => void;
}

function ExpenseFormModal({
  expense,
  currency,
  onClose,
}: ExpenseFormModalProps) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory>(
    expense?.category ?? "OTHER",
  );
  const [vendor, setVendor] = useState(expense?.vendor ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(
    expense ? fromCents(expense.amount) : "",
  );
  const [incurredAt, setIncurredAt] = useState(
    expense ? toDateInput(expense.incurredAt) : isoDate(new Date()),
  );
  const [jobId, setJobId] = useState(expense?.jobId ?? "");
  const [userId, setUserId] = useState(expense?.user?.id ?? "");
  const [errors, setErrors] = useState<{
    description?: string;
    amount?: string;
  }>({});

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({
      scope: "all",
      pageSize: 100,
      sort: "scheduledStart",
      order: "desc",
    }),
    queryFn: () =>
      api.jobs.list({
        scope: "all",
        pageSize: 100,
        sort: "scheduledStart",
        order: "desc",
      }),
    staleTime: 60_000,
  });

  const membersQuery = useQuery({
    queryKey: queryKeys.workspace.members,
    queryFn: () => api.workspace.members(),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      expense
        ? api.finance.updateExpense(expense.id, input)
        : api.finance.createExpense(input),
    onSuccess: () => {
      toast.success(expense ? "Expense updated" : "Expense recorded");
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    const trimmedDescription = description.trim();
    const amountCents = toCents(amount);
    if (!trimmedDescription)
      nextErrors.description = "Describe what this expense was for.";
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      nextErrors.amount = "Enter an amount greater than zero.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    mutation.mutate({
      category,
      vendor: vendor.trim() || null,
      description: trimmedDescription,
      amount: amountCents,
      incurredAt: fromDateInput(incurredAt),
      jobId: jobId || null,
      userId: userId || null,
    });
  }

  const jobs = jobsQuery.data?.data ?? [];
  const members = membersQuery.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={expense ? "Edit expense" : "Add expense"}
      description={`Amounts are entered in major units; ${currency} cents are stored.`}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="expense-form"
            variant="primary"
            loading={mutation.isPending}
          >
            {expense ? "Save changes" : "Record expense"}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required>
            <Select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ExpenseCategory)
              }
            >
              {EXPENSE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {EXPENSE_CATEGORY_META[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vendor">
            <Input
              value={vendor}
              maxLength={120}
              onChange={(event) => setVendor(event.target.value)}
              placeholder="e.g. Supply House"
            />
          </Field>
        </div>

        <Field label="Description" required error={errors.description}>
          <Input
            value={description}
            maxLength={240}
            invalid={Boolean(errors.description)}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What was purchased?"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${currency})`} required error={errors.amount}>
            <Input
              value={amount}
              inputMode="decimal"
              invalid={Boolean(errors.amount)}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Date incurred" required>
            <Input
              type="date"
              value={incurredAt}
              onChange={(event) => setIncurredAt(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job">
            <Select
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
            >
              <option value="">No job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.number} · {job.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Technician">
            <Select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.user.id}>
                  {member.user.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function RevenuePage() {
  const { workspace, role } = useAuth();
  const queryClient = useQueryClient();
  const currency = workspace?.currency ?? "USD";
  const canManage = role ? atLeast(role, "ADMIN") : false;

  const [period, setPeriod] = useState<PeriodValue>("90");
  const [customFrom, setCustomFrom] = useState(isoDate(daysAgo(90)));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));
  const [editing, setEditing] = useState<Expense | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState<"payments" | "expenses" | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<Expense | null>(
    null,
  );

  const range = useMemo(() => {
    if (period !== "custom") {
      return {
        from: isoDate(daysAgo(Number(period))),
        to: isoDate(new Date()),
      };
    }
    const from = customFrom || isoDate(daysAgo(30));
    const to = customTo || isoDate(new Date());
    return from <= to ? { from, to } : { from: to, to: from };
  }, [period, customFrom, customTo]);

  const summaryQuery = useQuery({
    queryKey: queryKeys.finance.summary(range),
    queryFn: () => api.finance.summary(range),
    placeholderData: keepPreviousData,
  });

  const paymentsQuery = useQuery({
    queryKey: queryKeys.finance.payments({ ...range, pageSize: 25 }),
    queryFn: () => api.finance.payments({ ...range, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  const expensesQuery = useQuery({
    queryKey: queryKeys.finance.expenses({ ...range, pageSize: 50 }),
    queryFn: () => api.finance.expenses({ ...range, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  const intelligenceQuery = useQuery({
    queryKey: queryKeys.intelligence.summary,
    queryFn: () => api.intelligence.summary(),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.finance.deleteExpense(id),
    onSuccess: () => {
      toast.success("Expense deleted");
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
      setConfirmingDelete(null);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const summary = summaryQuery.data;
  const payments = paymentsQuery.data?.data ?? [];
  const expenses = expensesQuery.data?.data ?? [];
  const upsells = intelligenceQuery.data?.upsells ?? [];

  const loading = summaryQuery.isPending;
  const error = summaryQuery.isError ? summaryQuery.error : null;

  function refreshAll() {
    void summaryQuery.refetch();
    void paymentsQuery.refetch();
    void expensesQuery.refetch();
    void intelligenceQuery.refetch();
  }

  async function exportRange(kind: "payments" | "expenses") {
    setExporting(kind);
    try {
      const blob =
        kind === "payments"
          ? await api.exports.payments(range)
          : await api.exports.expenses(range);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(blob, `${kind}-${stamp}.csv`);
      toast.success(
        kind === "payments" ? "Payments exported" : "Expenses exported",
      );
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="MONEY"
        title="Revenue"
        description="Collected cash, expenses and margin for the selected period — read from live invoices, payments and costs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {period === "custom" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  aria-label="Revenue range start"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="w-40"
                />
                <span className="text-xs text-muted">to</span>
                <Input
                  type="date"
                  aria-label="Revenue range end"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="w-40"
                />
              </div>
            ) : null}
            <PeriodSelector value={period} onChange={setPeriod} />
            <Button variant="ghost" size="sm" onClick={refreshAll}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading revenue">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : error ? (
        <Card className="p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 text-danger"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-fg">
                Could not load revenue
              </p>
              <p className="mt-1 text-sm text-muted">
                {apiErrorMessage(error)}
              </p>
              <Button className="mt-4" size="sm" onClick={refreshAll}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Collected"
              value={formatMoney(summary.collected, currency)}
              hint={`${summary.paymentCount} ${summary.paymentCount === 1 ? "payment" : "payments"}`}
              icon={<Banknote aria-hidden="true" />}
            />
            <StatCard
              label="Expenses"
              value={formatMoney(summary.expenses, currency)}
              hint={`${summary.expensesByCategory.length} ${
                summary.expensesByCategory.length === 1
                  ? "category"
                  : "categories"
              }`}
              icon={<Wallet aria-hidden="true" />}
            />
            <StatCard
              label="Gross margin"
              value={percentOrDash(summary.grossMarginPct)}
              hint={`${formatMoney(summary.grossProfit, currency)} gross profit`}
              icon={<TrendingUp aria-hidden="true" />}
            />
            <StatCard
              label="Outstanding"
              value={formatMoney(summary.outstanding, currency)}
              hint={
                summary.overdueAmount > 0
                  ? `${formatMoney(summary.overdueAmount, currency)} overdue`
                  : "Nothing overdue"
              }
              icon={<Receipt aria-hidden="true" />}
            />
            <StatCard
              label="Average ticket"
              value={formatMoney(summary.averageTicket, currency)}
              hint={`${formatMoney(summary.invoiced, currency)} invoiced`}
              icon={<BadgeDollarSign aria-hidden="true" />}
            />
          </div>

          <FinanceTrendChart summary={summary} />

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard
              title="Service margin"
              description="Revenue, cost and margin by service category."
            >
              <TableScroll label="Service margin">
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Margin</Th>
                    <Th align="right">Margin %</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.serviceMargins.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <TableEmpty message="No completed work in this period." />
                      </td>
                    </tr>
                  ) : (
                    summary.serviceMargins.map((row) => (
                      <tr key={row.category}>
                        <Td>{row.category}</Td>
                        <Td align="right">
                          {formatMoney(row.revenue, currency)}
                        </Td>
                        <Td align="right">{formatMoney(row.cost, currency)}</Td>
                        <Td align="right">
                          {formatMoney(row.margin, currency)}
                        </Td>
                        <Td align="right">{percentOrDash(row.marginPct)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableScroll>
            </SectionCard>

            <SectionCard
              title="Technician revenue"
              description="Jobs, revenue and margin attributed to each technician."
            >
              <TableScroll label="Technician revenue">
                <thead>
                  <tr>
                    <Th>Technician</Th>
                    <Th align="right">Jobs</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.technicianRevenue.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <TableEmpty message="No technician activity in this period." />
                      </td>
                    </tr>
                  ) : (
                    summary.technicianRevenue.map((row) => (
                      <tr key={row.user.id}>
                        <Td>
                          <span className="flex items-center gap-2">
                            <Wrench
                              className="size-3.5 text-muted"
                              aria-hidden="true"
                            />
                            {row.user.name}
                          </span>
                        </Td>
                        <Td align="right">{row.jobs}</Td>
                        <Td align="right">
                          {formatMoney(row.revenue, currency)}
                        </Td>
                        <Td align="right">
                          {formatMoney(row.margin, currency)}
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableScroll>
            </SectionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard
              title="Top customers"
              description="Highest revenue customers in the range."
            >
              <TableScroll label="Top customers">
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th align="right">Jobs</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <TableEmpty message="No customer revenue in this period." />
                      </td>
                    </tr>
                  ) : (
                    summary.topCustomers.map((row) => (
                      <tr key={row.customer.id}>
                        <Td>{row.customer.name}</Td>
                        <Td align="right">{row.jobs}</Td>
                        <Td align="right">
                          {formatMoney(row.revenue, currency)}
                        </Td>
                        <Td align="right">
                          {formatMoney(row.balance, currency)}
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableScroll>
            </SectionCard>

            <SectionCard
              title="Upsell opportunities"
              description="Explainable matches from the local intelligence engine."
              action={
                <Link
                  to="/app/estimates"
                  className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Open quotes
                </Link>
              }
            >
              {intelligenceQuery.isError ? (
                <TableEmpty message="Upsell signals are unavailable right now." />
              ) : upsells.length === 0 ? (
                <TableEmpty message="No upsell opportunities detected." />
              ) : (
                <ul className="divide-y divide-border/60">
                  {upsells.map((upsell) => (
                    <li
                      key={`${upsell.customer.id}-${upsell.serviceId}`}
                      className="p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">
                            {upsell.serviceName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {upsell.customer.name}
                          </p>
                        </div>
                        <span className="num text-sm text-fg">
                          {formatMoney(upsell.price, currency)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        {upsell.reason}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <Badge tone="accent">
                          Score {Math.round(upsell.score)}
                        </Badge>
                        <Link
                          to={`/app/estimates?new=1&customerId=${encodeURIComponent(upsell.customer.id)}&serviceId=${encodeURIComponent(upsell.serviceId)}`}
                          className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Quote this service
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Payments"
            description="Collected payments in the selected range."
            action={
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void exportRange("payments")}
                  loading={exporting === "payments"}
                >
                  {exporting === "payments" ? null : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  Export CSV
                </Button>
                <Link
                  to="/app/invoices"
                  className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  All invoices
                </Link>
              </div>
            }
          >
            {paymentsQuery.isError ? (
              <TableEmpty message="Payments could not be loaded." />
            ) : payments.length === 0 ? (
              <TableEmpty message="No payments collected in this period." />
            ) : (
              <TableScroll label="Payments">
                <thead>
                  <tr>
                    <Th>Received</Th>
                    <Th>Customer</Th>
                    <Th>Invoice</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <Td>{formatDate(payment.receivedAt)}</Td>
                      <Td>{payment.customer.name}</Td>
                      <Td>
                        <Link
                          to={`/app/invoices?invoice=${encodeURIComponent(payment.invoiceId)}`}
                          className="text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {payment.invoiceNumber}
                        </Link>
                      </Td>
                      <Td>{PAYMENT_METHOD_LABEL[payment.method]}</Td>
                      <Td className="text-muted">{payment.reference ?? "—"}</Td>
                      <Td align="right">
                        {formatMoney(payment.amount, currency)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
            {paymentsQuery.data && payments.length > 0 ? (
              <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
                Showing {payments.length} of {paymentsQuery.data.meta.total}{" "}
                payments
              </p>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Expenses"
            description="Costs recorded in the selected range."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void exportRange("expenses")}
                  loading={exporting === "expenses"}
                >
                  {exporting === "expenses" ? null : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  Export CSV
                </Button>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCreating(true)}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add expense
                  </Button>
                ) : (
                  <Badge tone="neutral">View only</Badge>
                )}
              </div>
            }
          >
            {expensesQuery.isError ? (
              <TableEmpty message="Expenses could not be loaded." />
            ) : expenses.length === 0 ? (
              <TableEmpty message="No expenses recorded in this period." />
            ) : (
              <TableScroll label="Expenses">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th>Vendor</Th>
                    <Th>Job</Th>
                    <Th>Technician</Th>
                    <Th align="right">Amount</Th>
                    {canManage ? <Th align="right">Actions</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <Td>{formatDate(expense.incurredAt)}</Td>
                      <Td className="max-w-[220px]">
                        <span
                          className="block truncate"
                          title={expense.description}
                        >
                          {expense.description}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone="neutral">
                          {EXPENSE_CATEGORY_META[expense.category]}
                        </Badge>
                      </Td>
                      <Td className="text-muted">{expense.vendor ?? "—"}</Td>
                      <Td className="text-muted">{expense.jobNumber ?? "—"}</Td>
                      <Td className="text-muted">
                        {expense.user ? expense.user.name : "—"}
                      </Td>
                      <Td align="right">
                        {formatMoney(expense.amount, currency)}
                      </Td>
                      {canManage ? (
                        <Td align="right">
                          <span className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(expense)}
                              aria-label={`Edit expense ${expense.description}`}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmingDelete(expense)}
                              aria-label={`Delete expense ${expense.description}`}
                              className="text-danger hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </Button>
                          </span>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
            {expensesQuery.data && expenses.length > 0 ? (
              <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
                Showing {expenses.length} of {expensesQuery.data.meta.total}{" "}
                expenses
              </p>
            ) : null}
          </SectionCard>

          <p className="text-xs leading-relaxed text-muted">
            Range {formatDate(summary.range.from)} –{" "}
            {formatDate(summary.range.to)} · figures in {currency}, stored and
            calculated in cents.
          </p>
        </>
      ) : null}

      {creating ? (
        <ExpenseFormModal
          expense={null}
          currency={currency}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <ExpenseFormModal
          expense={editing}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <Modal
        open={Boolean(confirmingDelete)}
        onClose={() => setConfirmingDelete(null)}
        title="Delete expense"
        description="This removes the cost from revenue reporting. It cannot be undone."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (confirmingDelete)
                  deleteMutation.mutate(confirmingDelete.id);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {confirmingDelete
            ? `“${confirmingDelete.description}” (${formatMoney(confirmingDelete.amount, currency)})`
            : ""}
        </p>
      </Modal>
    </div>
  );
}
