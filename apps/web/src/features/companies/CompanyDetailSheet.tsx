import { api, type Company, type Deal } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpRight,
  Globe2,
  Pencil,
  Phone,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Avatar } from "../../components/ui/Avatar";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../lib/auth";
import { cn, formatDate, formatMoney, relativeTime } from "../../lib/utils";
import { queryKeys } from "../../lib/query";
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

  const company = companyQuery.data;
  const contacts = contactsQuery.data?.data ?? [];
  const deals = dealsQuery.data?.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={company ? company.name : "Company"}
      description={
        company
          ? [company.industry, company.domain].filter(Boolean).join(" · ") || "Company record"
          : "Company record"
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
        </div>
      ) : null}
    </Modal>
  );
}
