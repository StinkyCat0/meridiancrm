import { api } from "@meridian/api-client";
import type {
  StudioInquiry,
  StudioInquiryFilter,
  StudioInquiryPage,
  StudioInquiryStatus,
} from "@meridian/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ArrowUpRight,
  Inbox,
  Mail,
  MailOpen,
  RotateCcw,
  Target,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { queryKeys } from "../../lib/query";
import { relativeTime } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import { StudioErrorCard, StudioPagination } from "./shared";

const PAGE_SIZE = 20;

const FILTERS: readonly { value: StudioInquiryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
];

const STATUS_TONE: Record<StudioInquiryStatus, BadgeTone> = {
  new: "accent",
  read: "neutral",
  archived: "warning",
};

function InquiriesSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading inquiries">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </Card>
      ))}
    </div>
  );
}

export default function StudioInquiriesPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StudioInquiryFilter>("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const inquiriesQuery = useQuery({
    queryKey: queryKeys.studio.inquiries({
      status: filter,
      page,
      pageSize: PAGE_SIZE,
    }),
    queryFn: () =>
      api.studio.inquiries({ status: filter, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const updateInquiry = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StudioInquiryStatus }) =>
      api.studio.updateInquiry(id, { status }),
    onSuccess: () => {
      toast.success("Inquiry updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.studio.all });
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const inquiriesPage: StudioInquiryPage | undefined = inquiriesQuery.data;
  const inquiries = inquiriesPage?.items ?? [];
  const pendingId = updateInquiry.isPending
    ? updateInquiry.variables?.id
    : null;

  function selectFilter(value: string) {
    const next = FILTERS.find((item) => item.value === value)?.value ?? "all";
    setFilter(next);
    setPage(1);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStatus(inquiry: StudioInquiry, status: StudioInquiryStatus) {
    updateInquiry.mutate({ id: inquiry.id, status });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-light tracking-tight text-fg">Inquiries</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Contact form submissions from the public website. Triage them here and
          follow the linked CRM deal when intake created one.
        </p>
      </div>

      <Tabs
        items={FILTERS.map((item) => ({
          value: item.value,
          label: item.label,
        }))}
        value={filter}
        onChange={selectFilter}
        ariaLabel="Filter inquiries by status"
      />

      {inquiriesQuery.isPending ? (
        <InquiriesSkeleton />
      ) : inquiriesQuery.isError ? (
        <StudioErrorCard
          title="Could not load inquiries."
          error={inquiriesQuery.error}
          onRetry={() => void inquiriesQuery.refetch()}
        />
      ) : inquiries.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={
            filter === "all" ? "No inquiries yet" : `No ${filter} inquiries`
          }
          description={
            filter === "all"
              ? "Messages sent through the website contact form appear here."
              : "Switch filters to see other inquiries."
          }
        />
      ) : (
        <div className="space-y-3">
          {inquiries.map((inquiry) => {
            const isExpanded = expanded.has(inquiry.id);
            const pending = pendingId === inquiry.id;
            const longMessage = inquiry.message.length > 220;

            return (
              <Card key={inquiry.id} className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[inquiry.status]}>
                        {inquiry.status}
                      </Badge>
                      <h3 className="truncate text-sm font-medium text-fg">
                        {inquiry.subject || "No subject"}
                      </h3>
                    </div>

                    <p className="mt-1.5 text-xs text-muted">
                      {inquiry.name} ·{" "}
                      <a
                        href={`mailto:${inquiry.email}`}
                        className="text-muted underline-offset-4 hover:text-fg hover:underline"
                      >
                        {inquiry.email}
                      </a>{" "}
                      · {relativeTime(inquiry.createdAt)}
                    </p>

                    <p
                      className={
                        isExpanded
                          ? "mt-3 whitespace-pre-line text-sm leading-relaxed text-fg/90"
                          : "mt-3 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-fg/90"
                      }
                    >
                      {inquiry.message}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {longMessage ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-accent underline-offset-4 hover:underline"
                          onClick={() => toggleExpanded(inquiry.id)}
                        >
                          {isExpanded ? "Show less" : "Read full message"}
                        </button>
                      ) : null}
                      {inquiry.crmDealId ? (
                        <Link
                          to={`/app/deals?deal=${encodeURIComponent(inquiry.crmDealId)}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
                        >
                          <Target className="size-3.5" aria-hidden="true" />
                          Open CRM deal
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                        </Link>
                      ) : null}
                      {inquiry.readAt ? (
                        <span className="text-xs text-muted">
                          Read {relativeTime(inquiry.readAt)}
                        </span>
                      ) : null}
                      {inquiry.archivedAt ? (
                        <span className="text-xs text-muted">
                          Archived {relativeTime(inquiry.archivedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
                    {inquiry.status !== "read" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        onClick={() => setStatus(inquiry, "read")}
                      >
                        <MailOpen className="size-3.5" aria-hidden="true" />
                        Mark read
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        onClick={() => setStatus(inquiry, "new")}
                      >
                        <Mail className="size-3.5" aria-hidden="true" />
                        Mark unread
                      </Button>
                    )}
                    {inquiry.status === "archived" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        onClick={() => setStatus(inquiry, "new")}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={pending}
                        onClick={() => setStatus(inquiry, "archived")}
                      >
                        <Archive className="size-3.5" aria-hidden="true" />
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          <Card>
            <StudioPagination
              page={inquiriesPage?.page ?? page}
              pageSize={inquiriesPage?.pageSize ?? PAGE_SIZE}
              total={inquiriesPage?.total ?? 0}
              onPage={setPage}
              disabled={inquiriesQuery.isFetching}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
