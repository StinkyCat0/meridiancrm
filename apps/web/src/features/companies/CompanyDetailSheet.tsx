import { api, type Company, type Deal, type Job, type Location } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpRight,
  Globe2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CUSTOMER_TYPE_META } from "@meridian/contracts";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
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
  const detailKey = queryKeys.companies.detail(companyId);
  const currency = workspace?.currency ?? "USD";

  const companyQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => api.companies.get(companyId),
    placeholderData: initialCompany ?? undefined,
    retry: false,
  });

  const contactsQuery = useQuery({
    queryKey: queryKeys.contacts.list({ companyId, pageSize: 100, archive: "active" }),
    queryFn: () => api.contacts.list({ companyId, pageSize: 100, archive: "active" }),
  });

  const dealsQuery = useQuery({
    queryKey: queryKeys.deals.list({ companyId, pageSize: 100 }),
    queryFn: () => api.deals.list({ companyId, pageSize: 100 }),
  });

  const locationsQuery = useQuery({
    queryKey: queryKeys.locations.list({ customerId: companyId, pageSize: 50, archive: "active" }),
    queryFn: () =>
      api.locations.list({ customerId: companyId, pageSize: 50, archive: "active" }),
  });

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({
      customerId: companyId,
      pageSize: 20,
      scope: "all",
      sort: "scheduledStart",
      order: "desc",
    }),
    queryFn: () =>
      api.jobs.list({
        customerId: companyId,
        pageSize: 20,
        scope: "all",
        sort: "scheduledStart",
        order: "desc",
      }),
  });

  const archive = useMutation({
    mutationFn: () => api.companies.archive(companyId),
    onSuccess: () => {
      queryClient.setQueryData<Company>(detailKey, (current) =>
        current ? { ...current, archived: true } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Company restored");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const archiveLocation = useMutation({
    mutationFn: (id: string) => api.locations.archive(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      toast.success("Location archived");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const company = companyQuery.data;
  const contacts = contactsQuery.data?.data ?? [];
  const deals = dealsQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const jobs = jobsQuery.data?.data ?? [];

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
                  {company.industry ?? "No industry"}
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
              <dt className="label-micro">Industry</dt>
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
          </section>

          <CompanyActivityTimeline companyId={company.id} />

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
