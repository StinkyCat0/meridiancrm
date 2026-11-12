import {
  api,
  type Communication,
  type CommunicationChannel,
  type CommunicationStatus,
  type CommunicationThread,
} from "@meridian/api-client";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  Inbox,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_CHANNEL_META,
  COMMUNICATION_INTENT_META,
} from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { queryKeys } from "../../lib/query";
import { cn, formatDate, relativeTime, useDebouncedValue } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { Composer } from "./Composer";

type Customer = CommunicationThread["customer"];
type ChannelFilter = CommunicationChannel | "ALL";

const CHANNEL_ICONS: Record<CommunicationChannel, LucideIcon> = {
  CALL: Phone,
  SMS: MessageSquare,
  EMAIL: Mail,
};

const STATUS_TONES: Record<CommunicationStatus, BadgeTone> = {
  LOGGED: "neutral",
  QUEUED: "warning",
  SENT: "accent",
  DELIVERED: "success",
  FAILED: "danger",
  MISSED: "danger",
  RECEIVED: "success",
};

function sentimentTone(sentiment: Communication["sentiment"]): BadgeTone {
  if (sentiment === "POSITIVE") return "success";
  if (sentiment === "NEGATIVE") return "danger";
  return "neutral";
}

function previewOf(message: Communication): string {
  const body = message.body?.trim();
  if (body) return body.replace(/\s+/g, " ");
  if (message.subject?.trim()) return message.subject.trim();
  return "No message body";
}

function QueryError({
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
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-5 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
        <AlertTriangle className="size-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
        {apiErrorMessage(error)}
      </p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-px px-3 py-3" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-start gap-3 rounded-input p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-10" />
            </div>
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: CommunicationThread;
  selected: boolean;
  onSelect: (thread: CommunicationThread) => void;
}) {
  const unread = thread.unreadCount > 0;
  const Icon = CHANNEL_ICONS[thread.lastMessage.channel];
  const preview = previewOf(thread.lastMessage);
  const outbound = thread.lastMessage.direction === "OUTBOUND";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(thread)}
        aria-current={selected ? "true" : undefined}
        aria-label={`${thread.customer.name}${unread ? `, ${thread.unreadCount} unread` : ""}. Last message ${relativeTime(thread.lastMessage.occurredAt)}: ${preview}`}
        className={cn(
          "flex w-full items-start gap-3 border-l-2 px-4 py-3.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          selected
            ? "border-accent bg-accent/[0.07]"
            : "border-transparent hover:bg-white/[0.03]",
        )}
      >
        <span className="relative shrink-0">
          <Avatar name={thread.customer.name} size="sm" />
          {unread ? (
            <span
              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent"
              aria-hidden="true"
            />
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                unread ? "font-medium text-fg" : "text-fg/90",
              )}
            >
              {thread.customer.name}
            </span>
            <time
              dateTime={thread.lastMessage.occurredAt}
              title={formatDate(thread.lastMessage.occurredAt, "MMM d, yyyy · h:mm a")}
              className="shrink-0 text-[10px] text-muted"
            >
              {relativeTime(thread.lastMessage.occurredAt)}
            </time>
          </span>

          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span>{COMMUNICATION_CHANNEL_META[thread.lastMessage.channel].label}</span>
            {thread.channels.length > 1 ? (
              <span aria-label={`Also ${thread.channels.length - 1} other channel(s)`}>
                +{thread.channels.length - 1}
              </span>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}</span>
          </span>

          <span className="mt-1 flex items-start justify-between gap-2">
            <span
              className={cn(
                "line-clamp-2 min-w-0 flex-1 break-words text-xs leading-relaxed",
                unread ? "text-fg/80" : "text-muted",
                !thread.lastMessage.body && "italic",
              )}
            >
              {outbound ? <span className="text-muted">You: </span> : null}
              {preview}
            </span>
            {unread ? (
              <span
                className="num mt-0.5 inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink"
                aria-hidden="true"
              >
                {thread.unreadCount}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function MessageBubble({ message }: { message: Communication }) {
  const outbound = message.direction === "OUTBOUND";
  const Icon = CHANNEL_ICONS[message.channel];
  const DirectionIcon = outbound ? ArrowUpRight : ArrowDownLeft;
  const body = message.body?.trim();
  const subject = message.subject?.trim();

  return (
    <article
      className={cn("flex flex-col", outbound ? "items-end" : "items-start")}
      aria-label={`${outbound ? "Outbound" : "Inbound"} ${COMMUNICATION_CHANNEL_META[message.channel].label}, ${message.status.toLowerCase()}`}
    >
      <div
        className={cn(
          "flex max-w-[92%] flex-wrap items-center gap-1.5 text-[10px] text-muted sm:max-w-[85%]",
          outbound && "justify-end",
        )}
      >
        <span className="inline-flex items-center gap-1">
          <Icon className="size-3" aria-hidden="true" />
          {COMMUNICATION_CHANNEL_META[message.channel].label}
        </span>
        <span className="inline-flex items-center gap-0.5">
          <DirectionIcon className="size-3" aria-hidden="true" />
          {outbound ? "Outbound" : "Inbound"}
        </span>
        <Badge tone={STATUS_TONES[message.status]}>{message.status}</Badge>
        <Badge tone="neutral">{COMMUNICATION_INTENT_META[message.intent]}</Badge>
        <Badge tone={sentimentTone(message.sentiment)}>
          <span className="capitalize">{message.sentiment.toLowerCase()}</span>
        </Badge>
        {message.aiGenerated ? (
          <Badge tone="violet">
            <Sparkles className="size-2.5" aria-hidden="true" />
            AI
          </Badge>
        ) : null}
        <time
          dateTime={message.occurredAt}
          title={formatDate(message.occurredAt, "MMM d, yyyy · h:mm a")}
        >
          {formatDate(message.occurredAt, "MMM d · h:mm a")}
        </time>
      </div>

      <div
        className={cn(
          "mt-1.5 max-w-[92%] rounded-card border px-3.5 py-2.5 text-sm sm:max-w-[85%]",
          outbound
            ? "border-accent/20 bg-accent/[0.07] text-fg"
            : "border-border bg-surface-2 text-fg",
        )}
      >
        {subject ? (
          <p className="mb-1 break-words text-xs font-medium uppercase tracking-wide text-accent">
            {subject}
          </p>
        ) : null}
        {body ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{body}</p>
        ) : (
          <p className="italic leading-relaxed text-muted">No body recorded.</p>
        )}
      </div>
    </article>
  );
}

export default function InboxPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const markedReadRef = useRef<Set<string>>(new Set());

  const threadFilters = useMemo(
    () => ({ q: debouncedSearch.trim() || undefined, limit: 100 }),
    [debouncedSearch],
  );

  const threadsQuery = useQuery({
    queryKey: queryKeys.communications.threads(threadFilters),
    queryFn: () => api.communications.threads(threadFilters),
    placeholderData: keepPreviousData,
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.communications.stats,
    queryFn: () => api.communications.stats(),
  });

  const selectedCustomerId = selectedCustomer?.id ?? null;
  const messageFilters = useMemo(
    () => ({
      customerId: selectedCustomerId ?? undefined,
      pageSize: 100,
      sort: "occurredAt",
      order: "desc" as const,
    }),
    [selectedCustomerId],
  );

  const messagesQuery = useQuery({
    queryKey: queryKeys.communications.list(messageFilters),
    queryFn: () => api.communications.list(messageFilters),
    enabled: selectedCustomerId !== null,
  });

  const messages = useMemo(() => {
    const rows = messagesQuery.data?.data ?? [];
    return [...rows].sort((a, b) => {
      const delta =
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      return delta !== 0 ? delta : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [messagesQuery.data]);

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await api.communications.update(id, { readAt: new Date().toISOString() });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.communications.all });
    },
    onError: (error, ids) => {
      for (const id of ids) markedReadRef.current.delete(id);
      toast.error(apiErrorMessage(error));
    },
  });
  const markRead = markReadMutation.mutate;

  // Opening a conversation clears its inbound unread state once. The ref keeps
  // a refetch from re-sending the same PATCHes while the invalidated cache settles.
  useEffect(() => {
    const unread = messages.filter(
      (message) =>
        message.direction === "INBOUND" &&
        !message.readAt &&
        !markedReadRef.current.has(message.id),
    );
    if (unread.length === 0) return;
    for (const message of unread) markedReadRef.current.add(message.id);
    markRead(unread.map((message) => message.id));
  }, [messages, markRead]);

  useEffect(() => {
    const node = messagesContainerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, selectedCustomerId]);

  const threads = threadsQuery.data ?? [];
  const visibleThreads = useMemo(
    () =>
      threads.filter((thread) => {
        if (channelFilter !== "ALL" && !thread.channels.includes(channelFilter)) {
          return false;
        }
        return !unreadOnly || thread.unreadCount > 0;
      }),
    [threads, channelFilter, unreadOnly],
  );

  const hasFilters = search.trim().length > 0 || channelFilter !== "ALL" || unreadOnly;
  const unreadInList = threads.reduce((total, thread) => total + thread.unreadCount, 0);
  const stats = statsQuery.data;

  function clearFilters() {
    setSearch("");
    setChannelFilter("ALL");
    setUnreadOnly(false);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMUNICATIONS"
        title="Inbox"
        description="A local, logged inbox. Calls, texts, and emails are recorded in this workspace — no carrier or mailbox is connected, so nothing is delivered."
        actions={
          <Badge tone="neutral">
            <Inbox className="size-3" aria-hidden="true" />
            Local log
          </Badge>
        }
      />

      {statsQuery.isPending ? (
        <div
          className="grid grid-cols-2 gap-3 xl:grid-cols-4"
          role="status"
          aria-label="Loading inbox metrics"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-4 h-7 w-14" />
              <Skeleton className="mt-2 h-2.5 w-24" />
            </Card>
          ))}
        </div>
      ) : statsQuery.isError ? (
        <Card>
          <QueryError
            title="Could not load inbox metrics."
            error={statsQuery.error}
            onRetry={() => void statsQuery.refetch()}
            className="py-6"
          />
        </Card>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="Calls today"
            value={stats.callsToday}
            hint="logged"
            icon={<Phone />}
          />
          <StatCard
            label="Texts today"
            value={stats.textsToday}
            hint="logged"
            icon={<MessageSquare />}
          />
          <StatCard
            label="Unread"
            value={stats.unread}
            hint="inbound messages"
            icon={<Inbox />}
          />
          <StatCard
            label="Open follow-ups"
            value={stats.followUpsOpen}
            hint="need a reply"
            icon={<CheckCheck />}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="flex min-h-[420px] flex-col overflow-hidden">
          <div className="space-y-3 border-b border-border p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customers"
                aria-label="Search conversations by customer"
                maxLength={120}
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
                aria-label="Filter conversations by channel"
                className="w-[132px]"
              >
                <option value="ALL">All channels</option>
                {COMMUNICATION_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {COMMUNICATION_CHANNEL_META[channel].label}
                  </option>
                ))}
              </Select>

              <button
                type="button"
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly((current) => !current)}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-input border px-3 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  unreadOnly
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-muted hover:text-fg",
                )}
              >
                <Inbox className="size-3.5" aria-hidden="true" />
                Unread
                {unreadInList > 0 ? (
                  <span className="num rounded-full bg-white/10 px-1.5 text-[10px] text-fg">
                    {unreadInList}
                  </span>
                ) : null}
              </button>

              <p className="num ml-auto text-xs text-muted" aria-live="polite">
                {threadsQuery.isPending
                  ? "Loading"
                  : threadsQuery.isError
                    ? "—"
                    : `${visibleThreads.length} ${visibleThreads.length === 1 ? "thread" : "threads"}`}
              </p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto lg:max-h-[620px]">
            {threadsQuery.isPending ? (
              <ListSkeleton />
            ) : threadsQuery.isError ? (
              <QueryError
                title="Could not load conversations."
                error={threadsQuery.error}
                onRetry={() => void threadsQuery.refetch()}
              />
            ) : visibleThreads.length === 0 ? (
              <EmptyState
                icon={<MessageSquare />}
                title={hasFilters ? "No conversations match." : "No conversations yet."}
                description={
                  hasFilters
                    ? "Try another channel, or clear the unread filter."
                    : "Log a call, text, or email with a customer and the thread will appear here."
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
                className="m-3 border-0 bg-transparent py-10"
              />
            ) : (
              <ul role="list" className="divide-y divide-border">
                {visibleThreads.map((thread) => (
                  <ThreadRow
                    key={thread.customer.id}
                    thread={thread}
                    selected={thread.customer.id === selectedCustomerId}
                    onSelect={(next) => setSelectedCustomer(next.customer)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex min-h-[520px] flex-col overflow-hidden">
          {!selectedCustomer ? (
            <EmptyState
              icon={<Inbox />}
              title="Select a conversation"
              description="Pick a customer to read their logged calls, texts, and emails, or to log a new interaction. Messages are stored in this workspace only."
              className="m-4 flex-1 border-0 bg-transparent sm:m-6"
            />
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={selectedCustomer.name} size="md" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-fg">
                      {selectedCustomer.name}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      {selectedCustomer.phone ? <span>{selectedCustomer.phone}</span> : null}
                      {selectedCustomer.phone ? <span aria-hidden="true">·</span> : null}
                      <span className="capitalize">
                        {selectedCustomer.customerType.toLowerCase().replace(/_/g, " ")}
                      </span>
                      {messagesQuery.data ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {messagesQuery.data.meta.total}{" "}
                            {messagesQuery.data.meta.total === 1 ? "message" : "messages"}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <Link
                  to={`/app/companies?company=${selectedCustomer.id}`}
                  className="inline-flex h-8 items-center rounded-input border border-border bg-surface-2 px-3 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Open customer
                </Link>
              </header>

              <div className="flex-1">
                {messagesQuery.isPending ? (
                  <div
                    className="space-y-4 p-4 sm:p-5"
                    role="status"
                    aria-label="Loading messages"
                  >
                    {Array.from({ length: 4 }, (_, index) => (
                      <div
                        key={index}
                        className={cn("flex flex-col gap-2", index % 2 === 0 ? "items-start" : "items-end")}
                      >
                        <Skeleton className="h-2.5 w-32" />
                        <Skeleton className={index % 2 === 0 ? "h-16 w-3/4" : "h-12 w-2/3"} />
                      </div>
                    ))}
                  </div>
                ) : messagesQuery.isError ? (
                  <QueryError
                    title="Could not load this conversation."
                    error={messagesQuery.error}
                    onRetry={() => void messagesQuery.refetch()}
                  />
                ) : messages.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-medium text-fg">No messages with this customer yet.</p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                      Use the form below to log the first call, text, or email.
                    </p>
                  </div>
                ) : (
                  <div
                    ref={messagesContainerRef}
                    role="log"
                    aria-label={`Message history with ${selectedCustomer.name}`}
                    className="max-h-[520px] space-y-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5"
                  >
                    {messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                  </div>
                )}
              </div>

              <Composer key={selectedCustomer.id} customer={selectedCustomer} />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
