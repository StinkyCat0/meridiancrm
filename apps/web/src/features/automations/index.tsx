import { api, type AutomationRule } from "@meridian/api-client";
import {
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_META,
  CUSTOMER_TYPE_META,
  JOB_PRIORITY_META,
  atLeast,
  type AutomationConditions,
  type AutomationRunStatus,
  type AutomationTrigger,
} from "@meridian/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  History,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { cn, formatDate, formatMoney, relativeTime } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { ACTION_LABELS, RuleModal } from "./RuleModal";

const RUN_STATUS_META: Record<
  AutomationRunStatus,
  { label: string; tone: BadgeTone }
> = {
  SUCCESS: { label: "Success", tone: "success" },
  SKIPPED: { label: "Skipped", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
};

const ENABLED_FILTERS = [
  { value: "all", label: "All rules" },
  { value: "true", label: "Enabled" },
  { value: "false", label: "Paused" },
] as const;

type EnabledFilter = (typeof ENABLED_FILTERS)[number]["value"];

function actionSummary(actions: AutomationRule["actions"]): string {
  const labels = new Set(actions.map((action) => ACTION_LABELS[action.type]));
  return [...labels].join(" · ");
}

function conditionSummary(
  conditions: AutomationConditions,
  currency: string,
): string {
  const parts: string[] = [];
  if (conditions.minTotal !== undefined) {
    parts.push(`Min ${formatMoney(conditions.minTotal, currency)}`);
  }
  if (conditions.customerTypes?.length) {
    parts.push(
      conditions.customerTypes
        .map((type) => CUSTOMER_TYPE_META[type].label)
        .join(", "),
    );
  }
  if (conditions.priorities?.length) {
    parts.push(
      conditions.priorities
        .map((priority) => JOB_PRIORITY_META[priority].label)
        .join(", "),
    );
  }
  return parts.join(" · ");
}

function entityLabel(entityType: string): string {
  return entityType.length > 0
    ? `${entityType.charAt(0).toUpperCase()}${entityType.slice(1)}`
    : "Entity";
}

function EnabledSwitch({
  rule,
  disabled,
  pending,
  onChange,
}: {
  rule: AutomationRule;
  disabled: boolean;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={rule.enabled}
      aria-label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`}
      disabled={disabled || pending}
      onClick={() => onChange(!rule.enabled)}
      title={disabled ? "Only admins can change automations" : undefined}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        rule.enabled
          ? "border-accent/40 bg-accent/80"
          : "border-border bg-white/10 hover:bg-white/15",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "ml-0.5 size-4 rounded-full bg-white shadow transition-transform duration-150",
          rule.enabled ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export default function AutomationsPage() {
  const { role, workspace } = useAuth();
  const queryClient = useQueryClient();
  const currency = workspace?.currency ?? "USD";
  const canManage = role ? atLeast(role, "ADMIN") : false;

  const [view, setView] = useState<"rules" | "runs">("rules");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [triggerFilter, setTriggerFilter] = useState<AutomationTrigger | "ALL">(
    "ALL",
  );
  const [runStatus, setRunStatus] = useState<AutomationRunStatus | "ALL">(
    "ALL",
  );
  const [runTrigger, setRunTrigger] = useState<AutomationTrigger | "ALL">(
    "ALL",
  );
  const [runRuleId, setRunRuleId] = useState("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

  const ruleFilters = {
    trigger: triggerFilter === "ALL" ? undefined : triggerFilter,
    enabled: enabledFilter === "all" ? undefined : enabledFilter,
    pageSize: 100,
    sort: "updatedAt",
    order: "desc" as const,
  };

  const rulesQuery = useQuery({
    queryKey: queryKeys.automations.list(ruleFilters),
    queryFn: () => api.automations.list(ruleFilters),
    placeholderData: keepPreviousData,
  });

  const runFilters = {
    trigger: runTrigger === "ALL" ? undefined : runTrigger,
    status: runStatus === "ALL" ? undefined : runStatus,
    ruleId: runRuleId === "all" ? undefined : runRuleId,
    pageSize: 50,
  };

  const runsQuery = useQuery({
    queryKey: queryKeys.automations.runs(runFilters),
    queryFn: () => api.automations.runs(runFilters),
    enabled: view === "runs",
    placeholderData: keepPreviousData,
  });

  // The runs rule filter should list every rule, not only the ones currently
  // narrowed by the rules tab filters.
  const ruleOptionsQuery = useQuery({
    queryKey: queryKeys.automations.list({ pageSize: 100 }),
    queryFn: () => api.automations.list({ pageSize: 100 }),
    enabled: view === "runs",
    placeholderData: keepPreviousData,
  });

  const rules = rulesQuery.data?.data ?? [];
  const rulesTotal = rulesQuery.data?.meta.total ?? 0;
  const ruleOptions = ruleOptionsQuery.data?.data ?? rules;
  const runs = runsQuery.data?.data ?? [];
  const runsTotal = runsQuery.data?.meta.total ?? 0;

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.automations.all });
  }

  const toggleEnabled = useMutation({
    mutationFn: ({
      rule,
      enabled,
    }: {
      rule: AutomationRule;
      enabled: boolean;
    }) => api.automations.update(rule.id, { enabled }),
    onSuccess: (updated) => {
      toast.success(
        updated.enabled ? "Automation enabled" : "Automation paused",
      );
      invalidateAutomations();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const runDue = useMutation({
    mutationFn: () => api.automations.runDue(),
    onSuccess: (result) => {
      const recordLabel = result.evaluated === 1 ? "due record" : "due records";
      const runLabel = result.run === 1 ? "rule run" : "rule runs";
      const summary = `Evaluated ${result.evaluated} ${recordLabel}`;
      if (result.run > 0) {
        toast.success(summary, {
          description: `${result.run} ${runLabel} recorded.`,
        });
      } else {
        toast.info(summary, {
          description: "No matching records needed action.",
        });
      }
      invalidateAutomations();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const removeRule = useMutation({
    mutationFn: (rule: AutomationRule) => api.automations.delete(rule.id),
    onSuccess: () => {
      toast.success("Automation deleted");
      setDeleting(null);
      invalidateAutomations();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const hasRuleFilters = triggerFilter !== "ALL" || enabledFilter !== "all";
  const hasRunFilters =
    runStatus !== "ALL" || runTrigger !== "ALL" || runRuleId !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="AUTOMATION"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Automations
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {rulesQuery.data ? rulesTotal : "—"}
            </span>
          </span>
        }
        description={
          canManage
            ? "Rules that follow up, tag and schedule work the moment something happens."
            : "Review the rules running this workspace. Admins manage changes."
        }
        actions={
          canManage ? (
            <>
              <Button
                variant="secondary"
                onClick={() => runDue.mutate()}
                loading={runDue.isPending}
              >
                <Play className="size-4" aria-hidden="true" />
                Run now
              </Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" />
                New rule
              </Button>
            </>
          ) : (
            <Badge tone="neutral">Read-only</Badge>
          )
        }
      />

      <Card className="space-y-3 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            ariaLabel="Automation view"
            items={[
              {
                value: "rules",
                label: "Rules",
                count: rulesQuery.data ? rulesTotal : undefined,
              },
              {
                value: "runs",
                label: "Runs",
                count: runsQuery.data ? runsTotal : undefined,
              },
            ]}
            value={view}
            onChange={(value) => setView(value as "rules" | "runs")}
            className="border-0"
          />
          <p aria-live="polite" className="num shrink-0 text-xs text-muted">
            {view === "rules"
              ? rulesQuery.isError
                ? "—"
                : rulesQuery.data
                  ? `${rulesTotal} ${rulesTotal === 1 ? "rule" : "rules"}`
                  : "Loading"
              : runsQuery.isError
                ? "—"
                : runsQuery.data
                  ? `${runsTotal} ${runsTotal === 1 ? "run" : "runs"}`
                  : "Loading"}
          </p>
        </div>

        {view === "rules" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={triggerFilter}
              onChange={(event) =>
                setTriggerFilter(
                  event.target.value as AutomationTrigger | "ALL",
                )
              }
              aria-label="Filter rules by trigger"
              className="sm:max-w-56"
            >
              <option value="ALL">All triggers</option>
              {AUTOMATION_TRIGGERS.map((value) => (
                <option key={value} value={value}>
                  {AUTOMATION_TRIGGER_META[value].label}
                </option>
              ))}
            </Select>
            <Select
              value={enabledFilter}
              onChange={(event) =>
                setEnabledFilter(event.target.value as EnabledFilter)
              }
              aria-label="Filter rules by state"
              className="sm:max-w-40"
            >
              {ENABLED_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {hasRuleFilters ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTriggerFilter("ALL");
                  setEnabledFilter("all");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Select
              value={runTrigger}
              onChange={(event) =>
                setRunTrigger(event.target.value as AutomationTrigger | "ALL")
              }
              aria-label="Filter runs by trigger"
              className="sm:max-w-52"
            >
              <option value="ALL">All triggers</option>
              {AUTOMATION_TRIGGERS.map((value) => (
                <option key={value} value={value}>
                  {AUTOMATION_TRIGGER_META[value].label}
                </option>
              ))}
            </Select>
            <Select
              value={runStatus}
              onChange={(event) =>
                setRunStatus(event.target.value as AutomationRunStatus | "ALL")
              }
              aria-label="Filter runs by status"
              className="sm:max-w-36"
            >
              <option value="ALL">All statuses</option>
              {(Object.keys(RUN_STATUS_META) as AutomationRunStatus[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {RUN_STATUS_META[value].label}
                  </option>
                ),
              )}
            </Select>
            <Select
              value={runRuleId}
              onChange={(event) => setRunRuleId(event.target.value)}
              aria-label="Filter runs by rule"
              className="sm:max-w-56"
            >
              <option value="all">All rules</option>
              {ruleOptions.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </Select>
            {hasRunFilters ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRunStatus("ALL");
                  setRunTrigger("ALL");
                  setRunRuleId("all");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        )}
      </Card>

      {view === "rules" ? (
        rulesQuery.isPending ? (
          <RuleListSkeleton />
        ) : rulesQuery.isError ? (
          <ErrorCard
            title="Could not load automations."
            message={apiErrorMessage(rulesQuery.error)}
            onRetry={() => void rulesQuery.refetch()}
          />
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Zap />}
            title={
              hasRuleFilters
                ? "No automations match those filters."
                : "No automations yet."
            }
            description={
              hasRuleFilters
                ? "Try another trigger or clear the state filter."
                : "Start with a follow-up task when a job completes, or request a review automatically."
            }
            action={
              hasRuleFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTriggerFilter("ALL");
                    setEnabledFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  New rule
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="label-micro px-4 py-3">
                        Rule
                      </th>
                      <th scope="col" className="label-micro px-4 py-3">
                        Trigger
                      </th>
                      <th scope="col" className="label-micro px-4 py-3">
                        State
                      </th>
                      <th
                        scope="col"
                        className="label-micro px-4 py-3 text-right"
                      >
                        Runs
                      </th>
                      <th scope="col" className="label-micro px-4 py-3">
                        Last run
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => {
                      const conditions = conditionSummary(
                        rule.conditions,
                        currency,
                      );
                      const pending =
                        toggleEnabled.isPending &&
                        toggleEnabled.variables?.rule.id === rule.id;
                      return (
                        <tr
                          key={rule.id}
                          className="border-b border-border/70 last:border-0"
                        >
                          <td className="px-4 py-3 align-top">
                            <p className="max-w-[280px] truncate font-medium text-fg">
                              {rule.name}
                            </p>
                            {rule.description ? (
                              <p className="mt-0.5 max-w-[300px] truncate text-xs text-muted">
                                {rule.description}
                              </p>
                            ) : null}
                            <p className="mt-1 max-w-[320px] truncate text-[11px] text-muted/80">
                              {actionSummary(rule.actions)}
                              {conditions ? ` · ${conditions}` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Badge tone="accent">
                              {AUTOMATION_TRIGGER_META[rule.trigger].label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-2">
                              <EnabledSwitch
                                rule={rule}
                                disabled={!canManage}
                                pending={pending}
                                onChange={(enabled) =>
                                  toggleEnabled.mutate({ rule, enabled })
                                }
                              />
                              <span className="text-xs text-muted">
                                {rule.enabled ? "Enabled" : "Paused"}
                              </span>
                            </div>
                          </td>
                          <td className="num px-4 py-3 text-right align-top text-fg">
                            {rule.runCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-muted">
                            {rule.lastRunAt ? (
                              <span
                                title={formatDate(
                                  rule.lastRunAt,
                                  "MMM d, yyyy · h:mm a",
                                )}
                              >
                                {relativeTime(rule.lastRunAt)}
                              </span>
                            ) : (
                              "Never"
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            {canManage ? (
                              <div className="flex justify-end gap-1">
                                <IconButton
                                  label={`Edit ${rule.name}`}
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setEditing(rule)}
                                >
                                  <Pencil aria-hidden="true" />
                                </IconButton>
                                <IconButton
                                  label={`Delete ${rule.name}`}
                                  variant="danger"
                                  size="sm"
                                  onClick={() => setDeleting(rule)}
                                >
                                  <Trash2 aria-hidden="true" />
                                </IconButton>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              {rules.map((rule) => {
                const conditions = conditionSummary(rule.conditions, currency);
                const pending =
                  toggleEnabled.isPending &&
                  toggleEnabled.variables?.rule.id === rule.id;
                return (
                  <Card key={rule.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg">
                          {rule.name}
                        </p>
                        {rule.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                            {rule.description}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone="accent">
                        {AUTOMATION_TRIGGER_META[rule.trigger].label}
                      </Badge>
                    </div>

                    <p className="mt-2 text-[11px] text-muted/80">
                      {actionSummary(rule.actions)}
                      {conditions ? ` · ${conditions}` : ""}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                      <div className="flex items-center gap-2">
                        <EnabledSwitch
                          rule={rule}
                          disabled={!canManage}
                          pending={pending}
                          onChange={(enabled) =>
                            toggleEnabled.mutate({ rule, enabled })
                          }
                        />
                        <span className="text-xs text-muted">
                          {rule.enabled ? "Enabled" : "Paused"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <>
                            <IconButton
                              label={`Edit ${rule.name}`}
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditing(rule)}
                            >
                              <Pencil aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={`Delete ${rule.name}`}
                              variant="danger"
                              size="sm"
                              onClick={() => setDeleting(rule)}
                            >
                              <Trash2 aria-hidden="true" />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="label-micro">Runs</dt>
                        <dd className="num mt-0.5 text-fg">{rule.runCount}</dd>
                      </div>
                      <div className="text-right">
                        <dt className="label-micro">Last run</dt>
                        <dd className="mt-0.5 text-muted">
                          {rule.lastRunAt
                            ? relativeTime(rule.lastRunAt)
                            : "Never"}
                        </dd>
                      </div>
                    </dl>
                  </Card>
                );
              })}
            </div>
          </>
        )
      ) : runsQuery.isPending ? (
        <RunListSkeleton />
      ) : runsQuery.isError ? (
        <ErrorCard
          title="Could not load automation runs."
          message={apiErrorMessage(runsQuery.error)}
          onRetry={() => void runsQuery.refetch()}
        />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={
            hasRunFilters ? "No runs match those filters." : "No runs yet."
          }
          description={
            hasRunFilters
              ? "Try another status, trigger or rule."
              : "When a trigger fires, its outcome appears here with what it touched."
          }
          action={
            hasRunFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setRunStatus("ALL");
                  setRunTrigger("ALL");
                  setRunRuleId("all");
                }}
              >
                Clear filters
              </Button>
            ) : canManage ? (
              <Button
                variant="secondary"
                onClick={() => runDue.mutate()}
                loading={runDue.isPending}
              >
                <Play className="size-4" aria-hidden="true" />
                Run now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-4 py-3">
                      Status
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Trigger
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Rule
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Entity
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Detail
                    </th>
                    <th
                      scope="col"
                      className="label-micro px-4 py-3 text-right"
                    >
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-border/70 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Badge tone={RUN_STATUS_META[run.status].tone}>
                          {RUN_STATUS_META[run.status].label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {AUTOMATION_TRIGGER_META[run.trigger].label}
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[200px] truncate text-fg">
                          {run.ruleName}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-fg">
                          {entityLabel(run.entityType)}
                        </p>
                        <p className="num text-[11px] text-muted">
                          {run.entityId ? run.entityId.slice(0, 10) : "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p
                          className="max-w-[260px] truncate text-xs text-muted"
                          title={run.detail ?? undefined}
                        >
                          {run.detail ?? "—"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted">
                        <span
                          title={formatDate(
                            run.createdAt,
                            "MMM d, yyyy · h:mm a",
                          )}
                        >
                          {formatDate(run.createdAt, "MMM d · h:mm a")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {runs.map((run) => (
              <Card key={run.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">
                      {run.ruleName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {AUTOMATION_TRIGGER_META[run.trigger].label}
                    </p>
                  </div>
                  <Badge tone={RUN_STATUS_META[run.status].tone}>
                    {RUN_STATUS_META[run.status].label}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted">
                  {run.detail ?? "No detail"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <span className="text-muted">
                    {entityLabel(run.entityType)}
                    {run.entityId ? ` · ${run.entityId.slice(0, 8)}` : ""}
                  </span>
                  <span
                    className="num shrink-0 text-muted"
                    title={formatDate(run.createdAt)}
                  >
                    {formatDate(run.createdAt, "MMM d · h:mm a")}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {creating ? (
        <RuleModal
          rule={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setView("rules");
          }}
        />
      ) : null}

      {editing ? (
        <RuleModal
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <Modal
          open
          size="sm"
          onClose={() => {
            if (!removeRule.isPending) setDeleting(null);
          }}
          title="Delete this automation?"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setDeleting(null)}
                disabled={removeRule.isPending}
              >
                Keep rule
              </Button>
              <Button
                variant="danger"
                onClick={() => removeRule.mutate(deleting)}
                loading={removeRule.isPending}
              >
                Delete rule
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-muted">
            <span className="text-fg">{deleting.name}</span> stops running
            immediately and is removed from the workspace. This action cannot be
            undone.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {message}
        </p>
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Card>
  );
}

function RuleListSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-9 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="rounded-card border border-border bg-surface p-4"
          >
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-3 h-5 w-9 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}

function RunListSkeleton() {
  return (
    <>
      <div className="hidden rounded-card border border-border bg-surface md:block">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="rounded-card border border-border bg-surface p-4"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </>
  );
}
