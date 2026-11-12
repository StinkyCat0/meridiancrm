import { api, type Company, type Deal, type Job, type Location } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  Archive,
  ArrowUpRight,
  ExternalLink,
  FileText,
  Globe2,
  MapPin,
  MessageSquare,
  Navigation,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  CUSTOMER_TYPE_META,
  type TimelineEntry,
  type TimelineEntryKind,
} from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useAuth } from "../../lib/auth";
import { cn, formatDate, formatDateTime, formatMoney, relativeTime } from "../../lib/utils";
import { queryKeys } from "../../lib/query";
import { LocationFormModal } from "../locations/LocationFormModal";
import { JobStatusBadge } from "../operations/shared";
import { CompanyActivityTimeline } from "./ActivityTimeline";
import { apiErrorMessage } from "./lib";

interface CompanyDetailSheetProps {
  companyId: string;
  initialCompany?: Company | null;
  onClose: () => void;
  onEdit: (company: Company) => void;
}

const momentumTone: Record<Deal["momentum"]["band"], string> = {
  hot: "bg-success",
  warm: "bg-warning",
  cold: "bg-danger",
};

const stageTone: Record<Deal["stage"]["kind"], BadgeTone> = {
  OPEN: "accent",
  WON: "success",
  LOST: "danger",
};

export function CompanyDetailSheet({
  companyId,
  initialCompany,
  onClose,
  onEdit,
}: CompanyDetailSheetProps) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [tab, setTab] = useState<"overview" | "interactions">("overview");
  const [jobPage, setJobPage] = useState(1);
  const [locationPage, setLocationPage] = useState(1);
  const [contactPage, setContactPage] = useState(1);
  const [dealPage, setDealPage] = useState(1);
  const detailKey = queryKeys.companies.detail(companyId);
  const currency = workspace?.currency ?? "USD";

  useEffect(() => {
    setJobPage(1);
    setLocationPage(1);
    setContactPage(1);
    setDealPage(1);
    setTab("overview");
  }, [companyId]);

  const companyQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => api.companies.get(companyId),
    placeholderData: initialCompany ?? undefined,
    retry: false,
  });

  const contactListQuery = {
    companyId,
    page: contactPage,
    pageSize: 8,
    archive: "active" as const,
  };

  const contactsQuery = useQuery({
    queryKey: queryKeys.contacts.list(contactListQuery),
    queryFn: () => api.contacts.list(contactListQuery),
  });

  const dealListQuery = {
    companyId,
    page: dealPage,
    pageSize: 8,
  };

  const dealsQuery = useQuery({
    queryKey: queryKeys.deals.list(dealListQuery),
    queryFn: () => api.deals.list(dealListQuery),
  });

  const locationListQuery = {
    customerId: companyId,
    page: locationPage,
    pageSize: 8,
    archive: "active" as const,
  };

  const locationsQuery = useQuery({
    queryKey: queryKeys.locations.list(locationListQuery),
    queryFn: () => api.locations.list(locationListQuery),
  });

  const jobListQuery = {
    customerId: companyId,
    page: jobPage,
    pageSize: 8,
    scope: "all" as const,
    sort: "scheduledStart",
    order: "desc" as const,
  };

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list(jobListQuery),
    queryFn: () => api.jobs.list(jobListQuery),
  });

  useEffect(() => {
    const totalPages = locationsQuery.data?.meta.totalPages;
    if (totalPages && locationPage > totalPages) setLocationPage(totalPages);
  }, [locationsQuery.data, locationPage]);

  useEffect(() => {
    const totalPages = jobsQuery.data?.meta.totalPages;
    if (totalPages && jobPage > totalPages) setJobPage(totalPages);
  }, [jobsQuery.data, jobPage]);

  useEffect(() => {
    const totalPages = contactsQuery.data?.meta.totalPages;
    if (totalPages && contactPage > totalPages) setContactPage(totalPages);
  }, [contactsQuery.data, contactPage]);

  useEffect(() => {
    const totalPages = dealsQuery.data?.meta.totalPages;
    if (totalPages && dealPage > totalPages) setDealPage(totalPages);
  }, [dealsQuery.data, dealPage]);

  function invalidateCustomerData() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.timeline(companyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dispatch.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.ops.summary() });
    void queryClient.invalidateQueries({ queryKey: ["insights"] });
  }

  const archive = useMutation({
    mutationFn: () => api.companies.archive(companyId),
    onSuccess: () => {
      queryClient.setQueryData<Company>(detailKey, (current) =>
        current ? { ...current, archived: true } : current,
      );
      invalidateCustomerData();
      setConfirmArchive(false);
      toast.success("Company archived");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const restore = useMutation({
    mutationFn: () => api.companies.restore(companyId),
    onSuccess: (restored) => {
      queryClient.setQueryData(detailKey, restored);
      invalidateCustomerData();
      toast.success("Company restored");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const archiveLocation = useMutation({
    mutationFn: (id: string) => api.locations.archive(id),
    onSuccess: () => {
      invalidateCustomerData();
      toast.success("Location archived");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const company = companyQuery.data;
  const contacts = contactsQuery.data?.data ?? [];
  const deals = dealsQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const jobs = jobsQuery.data?.data ?? [];

  const locationTotal = locationsQuery.data?.meta.total ?? 0;
  const locationTotalPages = locationsQuery.data?.meta.totalPages ?? 1;
  const locationPageSize = locationsQuery.data?.meta.pageSize ?? 8;
  const locationCurrentPage = locationsQuery.data?.meta.page ?? locationPage;
  const locationRangeStart =
    locationTotal === 0 ? 0 : (locationCurrentPage - 1) * locationPageSize + 1;
  const locationRangeEnd = Math.min(locationCurrentPage * locationPageSize, locationTotal);

  const jobTotal = jobsQuery.data?.meta.total ?? 0;
  const jobTotalPages = jobsQuery.data?.meta.totalPages ?? 1;
  const jobPageSize = jobsQuery.data?.meta.pageSize ?? 8;
  const jobCurrentPage = jobsQuery.data?.meta.page ?? jobPage;
  const jobRangeStart = jobTotal === 0 ? 0 : (jobCurrentPage - 1) * jobPageSize + 1;
  const jobRangeEnd = Math.min(jobCurrentPage * jobPageSize, jobTotal);

  const contactTotal = contactsQuery.data?.meta.total ?? 0;
  const contactTotalPages = contactsQuery.data?.meta.totalPages ?? 1;
  const contactPageSize = contactsQuery.data?.meta.pageSize ?? 8;
  const contactCurrentPage = contactsQuery.data?.meta.page ?? contactPage;
  const contactRangeStart =
    contactTotal === 0 ? 0 : (contactCurrentPage - 1) * contactPageSize + 1;
  const contactRangeEnd = Math.min(contactCurrentPage * contactPageSize, contactTotal);

  const dealTotal = dealsQuery.data?.meta.total ?? 0;
  const dealTotalPages = dealsQuery.data?.meta.totalPages ?? 1;
  const dealPageSize = dealsQuery.data?.meta.pageSize ?? 8;
  const dealCurrentPage = dealsQuery.data?.meta.page ?? dealPage;
  const dealRangeStart = dealTotal === 0 ? 0 : (dealCurrentPage - 1) * dealPageSize + 1;
  const dealRangeEnd = Math.min(dealCurrentPage * dealPageSize, dealTotal);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={company ? company.name : "Customer"}
      description={
        company
          ? [company.industry, company.domain].filter(Boolean).join(" · ") || "Customer record"
          : "Customer record"
      }
    >
      {companyQuery.isPending ? (
        <div className="space-y-5" role="status" aria-label="Loading company">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-32" />
        </div>
      ) : companyQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-danger">Could not load this company.</p>
          <p className="mt-1 text-sm text-muted">{apiErrorMessage(companyQuery.error)}</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void companyQuery.refetch()}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : company ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={company.name} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-medium text-fg">{company.name}</h3>
                  <Badge tone="accent">
                    {CUSTOMER_TYPE_META[company.customerType].label}
                  </Badge>
                  {company.archived ? <Badge tone="warning">Archived</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {company.industry ?? "No vertical"}
                  {company.domain ? ` · ${company.domain}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onEdit(company)}>
                <Pencil aria-hidden="true" className="size-3.5" />
                Edit
              </Button>
              {company.archived ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => restore.mutate()}
                  loading={restore.isPending}
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  Restore
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setConfirmArchive(true)}
                  disabled={archive.isPending}
                >
                  <Archive aria-hidden="true" className="size-3.5" />
                  Archive
                </Button>
              )}
            </div>
          </div>

          {confirmArchive ? (
            <div
              role="alertdialog"
              aria-label="Confirm archive company"
              className="rounded-card border border-danger/30 bg-danger/5 p-4"
            >
              <p className="text-sm font-medium text-fg">Archive this company?</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                It leaves active lists; the record and its history stay recoverable.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => archive.mutate()}
                  loading={archive.isPending}
                >
                  Archive company
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmArchive(false)}
                  disabled={archive.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <Tabs
            ariaLabel="Customer detail sections"
            items={[
              { value: "overview", label: "Overview" },
              { value: "interactions", label: "Interactions" },
            ]}
            value={tab}
            onChange={(value) =>
              setTab(value === "interactions" ? "interactions" : "overview")
            }
            className="border-0"
          />

          {tab === "overview" ? (
            <>
          <dl className="grid gap-4 rounded-card border border-border bg-surface-2/40 p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="label-micro">Domain</dt>
              <dd className="mt-1 truncate text-sm text-fg">{company.domain ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Customer type</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {CUSTOMER_TYPE_META[company.customerType].label}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Vertical</dt>
              <dd className="mt-1 truncate text-sm text-fg">{company.industry ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Size</dt>
              <dd className="mt-1 truncate text-sm text-fg">{company.size ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Phone</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {company.phone ? (
                  <a
                    href={`tel:${company.phone}`}
                    className="inline-flex max-w-full items-center gap-1.5 text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{company.phone}</span>
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Email</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {company.email ? (
                  <a
                    href={`mailto:${company.email}`}
                    className="text-accent hover:text-accent/80"
                  >
                    {company.email}
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Website</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{company.website}</span>
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Owner</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm text-fg">
                {company.owner ? (
                  <>
                    <Avatar name={company.owner.name} src={company.owner.avatarUrl} size="xs" />
                    <span className="truncate">{company.owner.name}</span>
                  </>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="label-micro">Address</dt>
              <dd className="mt-1 text-sm text-fg">{company.address ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Contacts</dt>
              <dd className="num mt-1 text-sm text-fg">{company.contactCount}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Open pipeline</dt>
              <dd className="num mt-1 text-sm text-fg">
                {formatMoney(company.openPipelineValue, currency)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Last updated</dt>
              <dd className="mt-1 text-sm text-fg">{relativeTime(company.updatedAt)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Added</dt>
              <dd className="mt-1 text-sm text-fg">{formatDate(company.createdAt)}</dd>
            </div>
          </dl>

          <div>
            <p className="label-micro mb-2">Notes</p>
            {company.notes ? (
              <p className="whitespace-pre-wrap rounded-card border border-border bg-surface-2/40 p-4 text-sm leading-relaxed text-muted">
                {company.notes}
              </p>
            ) : (
              <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted">
                No notes yet.
              </p>
            )}
          </div>

          {company.tags.length ? (
            <div>
              <p className="label-micro mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {company.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          <section aria-labelledby="company-locations-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="company-locations-heading" className="text-sm font-medium text-fg">
                  Service locations
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Addresses and site details the crew needs on arrival.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditingLocation(null);
                  setLocationFormOpen(true);
                }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add location
              </Button>
            </div>

            {locationsQuery.isPending ? (
              <div className="space-y-2" role="status" aria-label="Loading locations">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : locationsQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                <p>Could not load locations. {apiErrorMessage(locationsQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void locationsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : locations.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                No service locations yet. Add one before booking work.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {locations.map((location) => (
                  <li
                    key={location.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2 text-muted">
                        <MapPin className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                          {location.label}
                          {location.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {[location.line1, location.line2, location.city, location.state]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {location.openJobCount} open{" "}
                          {location.openJobCount === 1 ? "job" : "jobs"}
                          {location.gateCode ? ` · gate ${location.gateCode}` : ""}
                          {location.contactPhone ? ` · ${location.contactPhone}` : ""}
                        </p>
                        {location.latitude !== null && location.longitude !== null ? (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <Navigation className="size-3.5" aria-hidden="true" />
                            Open map
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingLocation(location);
                          setLocationFormOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={archiveLocation.isPending}
                        onClick={() => archiveLocation.mutate(location.id)}
                      >
                        <Archive className="size-3.5" aria-hidden="true" />
                        Archive
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {locationTotal > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="num text-xs text-muted">
                  Showing {locationRangeStart}–{locationRangeEnd} of {locationTotal}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setLocationPage((current) => Math.max(1, current - 1))}
                    disabled={locationCurrentPage <= 1}
                    aria-label="Previous locations page"
                  >
                    Previous
                  </Button>
                  <span className="num text-xs text-muted">
                    Page {locationCurrentPage} of {locationTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setLocationPage((current) =>
                        Math.min(locationTotalPages, current + 1),
                      )
                    }
                    disabled={locationCurrentPage >= locationTotalPages}
                    aria-label="Next locations page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="company-jobs-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="company-jobs-heading" className="text-sm font-medium text-fg">
                  Job history
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Recent visits and work orders for this customer.
                </p>
              </div>
              <Link
                to={`/app/schedule?new=1&customerId=${encodeURIComponent(company.id)}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface-2 px-3 text-xs font-medium text-fg transition-colors hover:border-white/15 hover:bg-surface-2/70"
              >
                <Wrench className="size-3.5" aria-hidden="true" />
                New job
              </Link>
            </div>
            {jobsQuery.isPending ? (
              <div className="space-y-2" role="status" aria-label="Loading jobs">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : jobsQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                <p>Could not load jobs. {apiErrorMessage(jobsQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void jobsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : jobs.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                No jobs for this customer yet.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {jobs.map((job: Job) => (
                  <li key={job.id}>
                    <Link
                      to={`/app/schedule?job=${encodeURIComponent(job.id)}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">
                          <span className="num mr-1.5 text-xs text-accent">{job.number}</span>
                          {job.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {job.scheduledStart
                            ? formatDateTime(job.scheduledStart)
                            : "Unscheduled"}{" "}
                          · {job.location.label}
                        </span>
                      </span>
                      <JobStatusBadge status={job.status} />
                      <span className="num shrink-0 text-sm text-fg">
                        {formatMoney(job.total, currency)}
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {jobTotal > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="num text-xs text-muted">
                  Showing {jobRangeStart}–{jobRangeEnd} of {jobTotal}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setJobPage((current) => Math.max(1, current - 1))}
                    disabled={jobCurrentPage <= 1}
                    aria-label="Previous jobs page"
                  >
                    Previous
                  </Button>
                  <span className="num text-xs text-muted">
                    Page {jobCurrentPage} of {jobTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setJobPage((current) => Math.min(jobTotalPages, current + 1))
                    }
                    disabled={jobCurrentPage >= jobTotalPages}
                    aria-label="Next jobs page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="company-contacts-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="company-contacts-heading" className="text-sm font-medium text-fg">
                Contacts
              </h3>
              <span className="num text-xs text-muted">
                {contactsQuery.data ? contactsQuery.data.meta.total : "—"}
              </span>
            </div>
            {contactsQuery.isPending ? (
              <div className="space-y-2" role="status" aria-label="Loading contacts">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : contactsQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                <p>Could not load contacts. {apiErrorMessage(contactsQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void contactsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : contacts.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                No contacts attached to this company yet.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {contacts.map((contact) => (
                  <li key={contact.id}>
                    <Link
                      to={`/app/contacts/${contact.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <Avatar
                        name={`${contact.firstName} ${contact.lastName}`}
                        size="xs"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">
                          {contact.firstName} {contact.lastName}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {contact.email ?? contact.title ?? "No contact detail"}
                        </span>
                      </span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {contactTotal > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="num text-xs text-muted">
                  Showing {contactRangeStart}–{contactRangeEnd} of {contactTotal}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setContactPage((current) => Math.max(1, current - 1))}
                    disabled={contactCurrentPage <= 1}
                    aria-label="Previous contacts page"
                  >
                    Previous
                  </Button>
                  <span className="num text-xs text-muted">
                    Page {contactCurrentPage} of {contactTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setContactPage((current) => Math.min(contactTotalPages, current + 1))
                    }
                    disabled={contactCurrentPage >= contactTotalPages}
                    aria-label="Next contacts page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="company-deals-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="company-deals-heading" className="text-sm font-medium text-fg">
                Deals
              </h3>
              <span className="num text-xs text-muted">
                {dealsQuery.data ? dealsQuery.data.meta.total : "—"}
              </span>
            </div>
            {dealsQuery.isPending ? (
              <div className="space-y-2" role="status" aria-label="Loading deals">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : dealsQuery.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                <p>Could not load deals. {apiErrorMessage(dealsQuery.error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void dealsQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : deals.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                No deals for this company yet.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {deals.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      to={`/app/deals?deal=${deal.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span
                        role="img"
                        aria-label={`Momentum ${deal.momentum.band}`}
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          momentumTone[deal.momentum.band],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{deal.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {deal.stage.name}
                        </span>
                      </span>
                      <span className="num shrink-0 text-sm text-fg">
                        {formatMoney(deal.value, deal.currency)}
                      </span>
                      <Badge tone={stageTone[deal.stage.kind]}>{deal.stage.kind}</Badge>
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {dealTotal > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="num text-xs text-muted">
                  Showing {dealRangeStart}–{dealRangeEnd} of {dealTotal}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDealPage((current) => Math.max(1, current - 1))}
                    disabled={dealCurrentPage <= 1}
                    aria-label="Previous deals page"
                  >
                    Previous
                  </Button>
                  <span className="num text-xs text-muted">
                    Page {dealCurrentPage} of {dealTotalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setDealPage((current) => Math.min(dealTotalPages, current + 1))
                    }
                    disabled={dealCurrentPage >= dealTotalPages}
                    aria-label="Next deals page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <CompanyActivityTimeline companyId={company.id} />
            </>
          ) : (
            <CompanyInteractions companyId={company.id} currency={currency} />
          )}

          {locationFormOpen ? (
            <LocationFormModal
              customerId={company.id}
              customerName={company.name}
              location={editingLocation}
              onClose={() => {
                setLocationFormOpen(false);
                setEditingLocation(null);
              }}
              onSaved={() => {
                setLocationFormOpen(false);
                setEditingLocation(null);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

const TIMELINE_ICON: Record<TimelineEntryKind, LucideIcon> = {
  activity: ActivityIcon,
  communication: MessageSquare,
  job: Wrench,
  estimate: FileText,
  invoice: Receipt,
  payment: Wallet,
};

function timelineHref(entry: TimelineEntry): string | null {
  if (entry.href) return entry.href;
  if (!entry.entityId) return null;
  const id = encodeURIComponent(entry.entityId);
  switch (entry.kind) {
    case "activity":
      return `/app/activities?activity=${id}`;
    case "communication":
      return `/app/inbox?communication=${id}`;
    case "job":
      return `/app/schedule?job=${id}`;
    case "estimate":
      return `/app/estimates?estimate=${id}`;
    case "invoice":
    case "payment":
      return `/app/invoices?invoice=${id}`;
    default:
      return null;
  }
}

function CompanyInteractions({
  companyId,
  currency,
}: {
  companyId: string;
  currency: string;
}) {
  const timelineQuery = useQuery({
    queryKey: queryKeys.companies.timeline(companyId),
    queryFn: () => api.companies.timeline(companyId, 200),
  });

  const items = timelineQuery.data?.items ?? [];
  const totalEntries = timelineQuery.data
    ? Object.values(timelineQuery.data.counts).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <section aria-labelledby="company-interactions-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="company-interactions-heading" className="text-sm font-medium text-fg">
            Interactions
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Calls, visits, quotes and money in one history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/inbox"
            className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface-2 px-3 text-xs font-medium text-fg transition-colors hover:border-white/15 hover:bg-surface-2/70"
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            Inbox
          </Link>
          <Link
            to="/app/schedule"
            className="inline-flex h-8 items-center gap-1.5 rounded-input border border-border bg-surface-2 px-3 text-xs font-medium text-fg transition-colors hover:border-white/15 hover:bg-surface-2/70"
          >
            <Wrench className="size-3.5" aria-hidden="true" />
            Schedule
          </Link>
        </div>
      </div>

      {timelineQuery.isPending ? (
        <div className="space-y-2" role="status" aria-label="Loading interactions">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : timelineQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="font-medium text-danger">Could not load interactions.</p>
          <p className="mt-1 text-muted">{apiErrorMessage(timelineQuery.error)}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => void timelineQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No interactions yet. Calls, jobs and invoices will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {items.map((entry) => {
            const Icon = TIMELINE_ICON[entry.kind];
            const href = timelineHref(entry);
            const content = (
              <>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2 text-muted">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="block truncate text-sm text-fg">{entry.title}</span>
                    {entry.status ? <Badge tone="neutral">{entry.status}</Badge> : null}
                  </span>
                  {entry.detail ? (
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {entry.detail}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  {entry.amount !== null ? (
                    <span className="num block text-sm text-fg">
                      {formatMoney(entry.amount, currency)}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-muted">
                    {relativeTime(entry.at)}
                  </span>
                </span>
                {href ? (
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                ) : null}
              </>
            );

            return (
              <li key={`${entry.kind}-${entry.id}`}>
                {href ? (
                  <Link
                    to={href}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 px-4 py-3">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length < totalEntries ? (
        <p className="num text-xs text-muted">
          Showing the latest {items.length} of {totalEntries} interactions.
        </p>
      ) : null}
    </section>
  );
}
