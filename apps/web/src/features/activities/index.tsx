import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { addDays, startOfDay } from "date-fns";
import {
  CalendarDays,
  Check,
  CheckSquare2,
  Clock3,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Activity,
  type ActivityListQuery,
  type ActivityType,
  type Page,
} from "@meridian/api-client";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_META } from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tooltip } from "../../components/ui/Tooltip";
import { queryKeys } from "../../lib/query";
import {
  cn,
  formatDate,
  relativeTime,
  useDebouncedValue,
} from "../../lib/utils";
import { ActivityModal } from "./ActivityModal";

const TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarDays,
  TASK: CheckSquare2,
};

type GroupKey = "overdue" | "today" | "upcoming" | "later" | "completed";

const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming · next 7 days" },
  { key: "later", label: "Later" },
  { key: "completed", label: "Completed" },
];

function byDueAt(a: Activity, b: Activity): number {
  const aTime = a.dueAt
    ? new Date(a.dueAt).getTime()
    : Number.POSITIVE_INFINITY;
  const bTime = b.dueAt
    ? new Date(b.dueAt).getTime()
    : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface ActivityRowProps {
  activity: Activity;
  highlighted: boolean;
  pending: boolean;
  onToggle: (activity: Activity) => void;
  onEdit: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
}

function ActivityRow({
  activity,
  highlighted,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: ActivityRowProps) {
  const Icon = TYPE_ICONS[activity.type];
  const completed = activity.completedAt !== null;
  const overdue =
    !completed &&
    activity.dueAt !== null &&
    new Date(activity.dueAt).getTime() < Date.now();
  const contactName = activity.contact
    ? `${activity.contact.firstName} ${activity.contact.lastName}`.trim()
    : null;
  const hasLinks = Boolean(
    activity.company ?? activity.dealTitle ?? contactName,
  );

  return (
    <li
      id={`activity-${activity.id}`}
      className={cn(
        "flex items-start gap-3 px-4 py-3.5 transition-colors sm:px-5",
        highlighted && "bg-accent/[0.06] ring-1 ring-inset ring-accent/30",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        aria-label={
          completed ? `Reopen ${activity.title}` : `Complete ${activity.title}`
        }
        disabled={pending}
        onClick={() => onToggle(activity)}
        className={cn(
          "group mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
          completed
            ? "border-success/40 bg-success/15 text-success"
            : "border-border bg-surface-2 text-transparent hover:border-accent/60 hover:text-accent",
        )}
      >
        {pending ? (
          <Loader2
            className="size-3 animate-spin text-muted"
            aria-hidden="true"
          />
        ) : (
          <Check
            className={cn(
              "size-3",
              completed
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
            aria-hidden="true"
          />
        )}
      </button>

      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2",
          completed ? "text-muted" : "text-accent",
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              "min-w-0 truncate text-sm font-medium",
              completed ? "text-muted line-through" : "text-fg",
            )}
          >
            {activity.title}
          </p>
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted/70">
            {ACTIVITY_TYPE_META[activity.type].label}
          </span>
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {!hasLinks ? <span>No linked record</span> : null}
          {activity.company ? (
            <Link
              to={`/app/companies?company=${activity.company.id}`}
              className="transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {activity.company.name}
            </Link>
          ) : null}
          {activity.company && (activity.dealTitle || contactName) ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {activity.dealId && activity.dealTitle ? (
            <Link
              to={`/app/deals?deal=${activity.dealId}`}
              className="transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {activity.dealTitle}
            </Link>
          ) : null}
          {activity.dealTitle && contactName ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {activity.contact ? (
            <Link
              to={`/app/contacts?contact=${activity.contact.id}`}
              className="transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {contactName}
            </Link>
          ) : null}
        </div>

        <p
          title={
            activity.completedAt
              ? `Completed ${formatDate(activity.completedAt, "MMM d, yyyy · h:mm a")}`
              : formatDate(activity.dueAt, "MMM d, yyyy · h:mm a")
          }
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-[11px]",
            overdue ? "text-danger" : "text-muted",
          )}
        >
          <Clock3 className="size-3" aria-hidden="true" />
          {activity.completedAt
            ? activity.dueAt
              ? `Due ${relativeTime(activity.dueAt)} · completed ${relativeTime(activity.completedAt)}`
              : `Completed ${relativeTime(activity.completedAt)}`
            : activity.dueAt
              ? relativeTime(activity.dueAt)
              : "No due date"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-1">
        <Tooltip label={activity.owner?.name ?? "Unassigned"}>
          <Avatar
            name={activity.owner?.name ?? "Unassigned"}
            src={activity.owner?.avatarUrl}
            size="sm"
          />
        </Tooltip>
        <div className="flex items-center">
          <Tooltip label="Edit activity">
            <IconButton
              label="Edit activity"
              size="sm"
              onClick={() => onEdit(activity)}
            >
              <Pencil aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Delete activity">
            <IconButton
              label="Delete activity"
              size="sm"
              variant="danger"
              onClick={() => onDelete(activity)}
            >
              <Trash2 aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </li>
  );
}

function ActivityListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading activities">
      <Skeleton className="h-4 w-24" />
      <Card className="divide-y divide-border">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-start gap-3 p-4">
            <Skeleton className="size-5 rounded-[6px]" />
            <Skeleton className="size-8 rounded-input" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="size-8 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export default function ActivitiesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<"ALL" | ActivityType>("ALL");
  const [scope, setScope] = useState<"open" | "completed" | "all">("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(searchParams.get("new") === "1");
  const [editing, setEditing] = useState<Activity | null>(null);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const highlightedId = searchParams.get("activity");
  const newParam = searchParams.get("new") === "1";

  useEffect(() => {
    if (newParam) {
      setEditing(null);
      setModalOpen(true);
    }
  }, [newParam]);

  const filters = useMemo<ActivityListQuery>(
    () => ({
      type: typeFilter === "ALL" ? undefined : typeFilter,
      completed:
        scope === "open" ? false : scope === "completed" ? true : undefined,
      q: debouncedSearch.trim() || undefined,
      pageSize: 50,
      sort: "dueAt",
      order: "asc",
    }),
    [typeFilter, scope, debouncedSearch],
  );

  const activitiesQuery = useInfiniteQuery({
    queryKey: queryKeys.activities.list(filters),
    queryFn: ({ pageParam }) =>
      api.activities.list({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages
        ? lastPage.meta.page + 1
        : undefined,
  });

  const activities = useMemo(
    () => activitiesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [activitiesQuery.data],
  );
  const total = activitiesQuery.data?.pages[0]?.meta.total ?? 0;

  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const weekEnd = addDays(today, 8);
    const buckets: Record<GroupKey, Activity[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      later: [],
      completed: [],
    };

    for (const activity of activities) {
      if (activity.completedAt) {
        buckets.completed.push(activity);
        continue;
      }
      if (!activity.dueAt) {
        buckets.later.push(activity);
        continue;
      }
      const due = new Date(activity.dueAt);
      if (due < today) buckets.overdue.push(activity);
      else if (due < tomorrow) buckets.today.push(activity);
      else if (due < weekEnd) buckets.upcoming.push(activity);
      else buckets.later.push(activity);
    }

    for (const key of GROUPS) buckets[key.key].sort(byDueAt);

    return GROUPS.map((group) => ({
      ...group,
      items: buckets[group.key],
    })).filter((group) => group.items.length > 0);
  }, [activities]);

  useEffect(() => {
    if (!highlightedId) return;
    const element = document.getElementById(`activity-${highlightedId}`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightedId, activities.length]);

  const toggle = useMutation({
    mutationFn: ({
      id,
      completedAt,
    }: {
      id: string;
      completedAt: string | null;
    }) => api.activities.update(id, { completedAt }),
    onMutate: async ({ id, completedAt }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities.all });
      const previous = queryClient.getQueriesData<InfiniteData<Page<Activity>>>(
        {
          queryKey: queryKeys.activities.all,
        },
      );
      queryClient.setQueriesData<InfiniteData<Page<Activity>>>(
        { queryKey: queryKeys.activities.all },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  data: page.data.map((activity) =>
                    activity.id === id
                      ? { ...activity, completedAt }
                      : activity,
                  ),
                })),
              }
            : data,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error(messageFor(error, "Could not update the activity."));
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.completedAt ? "Activity completed" : "Activity reopened",
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.activities.all,
      });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.activities.delete(id),
    onSuccess: () => {
      toast.success("Activity deleted");
      setDeleting(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.activities.all,
      });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) =>
      toast.error(messageFor(error, "Could not delete the activity.")),
  });

  const hasFilters =
    typeFilter !== "ALL" || scope !== "all" || search.trim().length > 0;

  function clearFilters() {
    setTypeFilter("ALL");
    setScope("all");
    setSearch("");
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    if (newParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Activity"
        title="Activities"
        description="Every note, call, meeting and task in one follow-through queue."
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" />
            Log activity
          </Button>
        }
      />

      <Card className="p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search activity titles"
              aria-label="Search activities"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 md:flex md:shrink-0">
            <Select
              aria-label="Filter by type"
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as "ALL" | ActivityType)
              }
              className="md:w-40"
            >
              <option value="ALL">All types</option>
              {ACTIVITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACTIVITY_TYPE_META[type].label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by completion"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "open" | "completed" | "all")
              }
              className="md:w-40"
            >
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="all">All</option>
            </Select>
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              className="md:ml-1"
              onClick={clearFilters}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </Card>

      {activitiesQuery.isLoading ? <ActivityListSkeleton /> : null}

      {activitiesQuery.isError ? (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <span
              className="mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted"
              aria-hidden="true"
            >
              <RefreshCw className="size-5" />
            </span>
            <p className="text-sm font-medium text-fg">
              Could not load activities
            </p>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
              {messageFor(
                activitiesQuery.error,
                "Check your connection and try again.",
              )}
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => void activitiesQuery.refetch()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </Card>
      ) : null}

      {activitiesQuery.isSuccess && activities.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={hasFilters ? "No activities match" : "No activity yet"}
          description={
            hasFilters
              ? "Loosen the filters or search for a different title."
              : "Log a note, call, meeting or task to start the follow-through queue."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" />
                Log activity
              </Button>
            )
          }
        />
      ) : null}

      {activities.length > 0 ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <section
              key={group.key}
              className="space-y-2"
              aria-labelledby={`group-${group.key}`}
            >
              <div className="flex items-center gap-2">
                <h2 id={`group-${group.key}`} className="label-micro">
                  {group.label}
                </h2>
                <span className="num rounded-full border border-border bg-white/5 px-1.5 py-px text-[10px] text-muted">
                  {group.items.length}
                </span>
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {group.items.map((activity) => (
                    <ActivityRow
                      key={activity.id}
                      activity={activity}
                      highlighted={activity.id === highlightedId}
                      pending={
                        toggle.isPending && toggle.variables?.id === activity.id
                      }
                      onToggle={(item) =>
                        toggle.mutate({
                          id: item.id,
                          completedAt: item.completedAt
                            ? null
                            : new Date().toISOString(),
                        })
                      }
                      onEdit={(item) => {
                        setEditing(item);
                        setModalOpen(true);
                      }}
                      onDelete={(item) => {
                        remove.reset();
                        setDeleting(item);
                      }}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}

          <div className="flex flex-col items-center justify-center gap-2 pt-1">
            {activitiesQuery.hasNextPage ? (
              <Button
                variant="secondary"
                loading={activitiesQuery.isFetchingNextPage}
                onClick={() => void activitiesQuery.fetchNextPage()}
              >
                Load 50 more
              </Button>
            ) : (
              <p className="text-xs text-muted">
                {total} {total === 1 ? "activity" : "activities"} shown
              </p>
            )}
          </div>
        </div>
      ) : null}

      <ActivityModal open={modalOpen} activity={editing} onClose={closeModal} />

      <Modal
        open={deleting !== null}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        title="Delete activity?"
        description={
          deleting
            ? `“${deleting.title}” will be removed permanently.`
            : undefined
        }
        size="sm"
        closeOnBackdrop={!remove.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleting(null)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          The linked deal or company stays intact. This action cannot be undone.
        </p>
        {remove.isError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {messageFor(remove.error, "Could not delete the activity.")}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
