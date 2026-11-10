import { api, type Activity, type CreateActivityInput } from "@meridian/api-client";
import {
  ACTIVITY_TYPE_META,
  type ActivityType,
} from "@meridian/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare2,
  Mail,
  Phone,
  Plus,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { Textarea } from "../../components/ui/Textarea";
import { cn, formatDate, relativeTime } from "../../lib/utils";
import { queryKeys } from "../../lib/query";
import { apiErrorMessage } from "./lib";

const TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  TASK: CheckSquare2,
};

interface ContactActivityTimelineProps {
  contactId: string;
}

export function ContactActivityTimeline({ contactId }: ContactActivityTimelineProps) {
  const queryClient = useQueryClient();
  const scope = { contactId, pageSize: 50 };
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);

  const activitiesQuery = useQuery({
    queryKey: queryKeys.activities.list(scope),
    queryFn: () => api.activities.list(scope),
  });

  function invalidateActivityViews() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    void queryClient.invalidateQueries({ queryKey: ["insights"] });
  }

  const createNote = useMutation({
    mutationFn: (input: CreateActivityInput) => api.activities.create(input),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setTitleError(null);
      invalidateActivityViews();
      toast.success("Note added");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const toggleTask = useMutation({
    mutationFn: (activity: Activity) =>
      api.activities.update(activity.id, {
        completedAt: activity.completedAt ? null : new Date().toISOString(),
      }),
    onSuccess: (updated) => {
      invalidateActivityViews();
      toast.success(updated.completedAt ? "Task completed" : "Task reopened");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createNote.isPending) return;
    if (!title.trim()) {
      setTitleError("Add a short title for the note.");
      return;
    }
    createNote.mutate({
      type: "NOTE",
      title: title.trim(),
      body: body.trim() || null,
      contactId,
    });
  }

  const activities = activitiesQuery.data?.data ?? [];

  return (
    <section aria-labelledby="contact-activity-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="contact-activity-heading" className="text-sm font-medium text-fg">
          Activity
        </h3>
        <span className="num text-xs text-muted">
          {activitiesQuery.data ? `${activitiesQuery.data.meta.total} entries` : "—"}
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-card border border-border bg-surface-2/60 p-3.5"
      >
        <Field
          label="Add a note"
          htmlFor="contact-note-title"
          error={titleError}
          hint="Log calls, context or next steps against this contact."
        >
          <Input
            id="contact-note-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleError) setTitleError(null);
            }}
            invalid={Boolean(titleError)}
            placeholder="What happened?"
            maxLength={160}
          />
        </Field>
        <Textarea
          aria-label="Note details"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Optional detail"
          maxLength={5000}
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="secondary" loading={createNote.isPending}>
            <Plus aria-hidden="true" className="size-3.5" />
            Log note
          </Button>
        </div>
      </form>

      {activitiesQuery.isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading activity">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : activitiesQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <p>Could not load activity. {apiErrorMessage(activitiesQuery.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => void activitiesQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : activities.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No activity yet. The first note is the easiest next step.
        </p>
      ) : (
        <ol className="space-y-4 border-l border-border pl-4">
          {activities.map((activity) => {
            const Icon = TYPE_ICONS[activity.type];
            const isTask = activity.type === "TASK";
            const completed = Boolean(activity.completedAt);
            const taskPending =
              toggleTask.isPending && toggleTask.variables?.id === activity.id;

            return (
              <li key={activity.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-[25px] top-0.5 flex size-4 items-center justify-center rounded-full border border-border bg-surface text-muted"
                >
                  <span className="size-1.5 rounded-full bg-current" />
                </span>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2 text-muted">
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="label-micro">{ACTIVITY_TYPE_META[activity.type].label}</span>
                      <span className="text-[11px] text-muted">
                        {relativeTime(activity.createdAt)}
                      </span>
                      {activity.dueAt ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                          <CalendarDays className="size-3" aria-hidden="true" />
                          Due {formatDate(activity.dueAt, "MMM d")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-start gap-2">
                      {isTask ? (
                        <input
                          type="checkbox"
                          checked={completed}
                          disabled={taskPending}
                          onChange={() => toggleTask.mutate(activity)}
                          aria-label={
                            completed ? `Reopen ${activity.title}` : `Complete ${activity.title}`
                          }
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-sm leading-snug text-fg",
                            completed && "text-muted line-through",
                          )}
                        >
                          {activity.title}
                        </p>
                        {activity.body ? (
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                            {activity.body}
                          </p>
                        ) : null}
                        {activity.owner ? (
                          <p className="mt-1.5 text-[11px] text-muted/80">
                            {activity.owner.name}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
