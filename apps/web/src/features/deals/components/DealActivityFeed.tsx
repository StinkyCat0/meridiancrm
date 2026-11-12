import {
  ACTIVITY_TYPE_META,
  type ActivityType,
  type Deal,
} from "@meridian/contracts";
import {
  Mail,
  Phone,
  Plus,
  Square,
  SquareCheck,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Skeleton } from "../../../components/ui/Skeleton";
import { cn, formatDate, relativeTime } from "../../../lib/utils";
import {
  useCreateDealActivity,
  useDealActivities,
  useToggleActivity,
} from "../hooks";

const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  TASK: SquareCheck,
};

const QUICK_TYPES = ["NOTE", "CALL", "MEETING"] as const;
type QuickType = (typeof QUICK_TYPES)[number];

export function DealActivityFeed({ deal }: { deal: Deal }) {
  const activities = useDealActivities(deal.id);
  const createActivity = useCreateDealActivity();
  const toggleActivity = useToggleActivity();
  const [activityType, setActivityType] = useState<QuickType>("NOTE");
  const [quickTitle, setQuickTitle] = useState("");

  const pendingTaskId = toggleActivity.isPending
    ? toggleActivity.variables?.activity.id
    : null;
  const rows = activities.data?.data ?? [];

  function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    createActivity.mutate(
      {
        type: activityType,
        title,
        dealId: deal.id,
        contactId: deal.contact?.id ?? null,
        companyId: deal.company?.id ?? null,
      },
      { onSuccess: () => setQuickTitle("") },
    );
  }

  return (
    <section aria-labelledby="deal-activity-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="deal-activity-heading" className="label-micro">
          Activity
        </h3>
        {rows.length > 0 ? (
          <span className="num text-[10px] text-muted">
            {rows.length} logged
          </span>
        ) : null}
      </div>

      <div className="mt-2 rounded-card border border-border bg-surface-2/40 p-3">
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Activity type"
        >
          {QUICK_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={activityType === type ? "secondary" : "ghost"}
              aria-pressed={activityType === type}
              onClick={() => setActivityType(type)}
            >
              {ACTIVITY_TYPE_META[type].label}
            </Button>
          ))}
        </div>
        <form
          onSubmit={handleQuickAdd}
          className="mt-2 flex items-center gap-2"
        >
          <Input
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
            aria-label={`${ACTIVITY_TYPE_META[activityType].label} title`}
            placeholder={`Log a ${ACTIVITY_TYPE_META[activityType].label.toLowerCase()}…`}
            maxLength={160}
          />
          <Button
            type="submit"
            variant="primary"
            aria-label="Add activity"
            loading={createActivity.isPending}
            disabled={!quickTitle.trim()}
          >
            {createActivity.isPending ? null : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            <span className="sr-only">Add activity</span>
          </Button>
        </form>
      </div>

      {activities.isPending ? (
        <div className="mt-3 space-y-3" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      ) : activities.isError ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Couldn&apos;t load activity.{" "}
          <button
            type="button"
            onClick={() => void activities.refetch()}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          No activity yet. Log the first touchpoint above.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.type];
            const completed = Boolean(activity.completedAt);
            return (
              <li key={activity.id} className="flex gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
                    completed
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-surface-2 text-muted",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm leading-snug text-fg",
                        completed && "text-muted line-through",
                      )}
                    >
                      {activity.title}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted">
                      {relativeTime(activity.createdAt)}
                    </span>
                  </div>
                  {activity.body ? (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted">
                      {activity.body}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
                    <span>{ACTIVITY_TYPE_META[activity.type].label}</span>
                    {activity.dueAt ? (
                      <span>Due {formatDate(activity.dueAt)}</span>
                    ) : null}
                    {activity.owner ? (
                      <span>by {activity.owner.name}</span>
                    ) : null}
                    {activity.type === "TASK" ? (
                      <button
                        type="button"
                        disabled={pendingTaskId === activity.id}
                        onClick={() =>
                          toggleActivity.mutate({
                            activity,
                            completed: !completed,
                          })
                        }
                        aria-label={
                          completed
                            ? `Reopen task ${activity.title}`
                            : `Mark task ${activity.title} complete`
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium transition-colors",
                          completed
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-border text-muted hover:border-accent/40 hover:text-accent",
                          "disabled:opacity-50",
                        )}
                      >
                        {completed ? (
                          <SquareCheck className="size-3" aria-hidden="true" />
                        ) : (
                          <Square className="size-3" aria-hidden="true" />
                        )}
                        {completed ? "Completed" : "Mark complete"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
