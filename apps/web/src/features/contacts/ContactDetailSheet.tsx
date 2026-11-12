import { api, type Contact, type Deal } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpRight,
  Building2,
  Mail,
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
import { cn, formatDate, formatMoney, relativeTime } from "../../lib/utils";
import { queryKeys } from "../../lib/query";
import { ContactActivityTimeline } from "./ActivityTimeline";
import { apiErrorMessage, contactName } from "./lib";

interface ContactDetailSheetProps {
  contactId: string;
  initialContact?: Contact | null;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
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

export function ContactDetailSheet({
  contactId,
  initialContact,
  onClose,
  onEdit,
}: ContactDetailSheetProps) {
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const detailKey = queryKeys.contacts.detail(contactId);

  const contactQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => api.contacts.get(contactId),
    placeholderData: initialContact ?? undefined,
    retry: false,
  });

  const dealsQuery = useQuery({
    queryKey: queryKeys.deals.list({ contactId, status: "open", pageSize: 50 }),
    queryFn: () => api.deals.list({ contactId, status: "open", pageSize: 50 }),
  });

  const archive = useMutation({
    mutationFn: () => api.contacts.archive(contactId),
    onSuccess: () => {
      queryClient.setQueryData<Contact>(detailKey, (current) =>
        current ? { ...current, archived: true } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      setConfirmArchive(false);
      toast.success("Contact archived");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const restore = useMutation({
    mutationFn: () => api.contacts.restore(contactId),
    onSuccess: (restored) => {
      queryClient.setQueryData(detailKey, restored);
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Contact restored");
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const contact = contactQuery.data;
  const deals = dealsQuery.data?.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={contact ? contactName(contact) : "Contact"}
      description={
        contact
          ? [contact.title, contact.company?.name]
              .filter(Boolean)
              .join(" · ") || "Contact record"
          : "Contact record"
      }
    >
      {contactQuery.isPending ? (
        <div className="space-y-5" role="status" aria-label="Loading contact">
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
      ) : contactQuery.isError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-danger">
            Could not load this contact.
          </p>
          <p className="mt-1 text-sm text-muted">
            {apiErrorMessage(contactQuery.error)}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void contactQuery.refetch()}
            >
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : contact ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={contactName(contact)} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-medium text-fg">
                    {contactName(contact)}
                  </h3>
                  {contact.archived ? (
                    <Badge tone="warning">Archived</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {contact.title ?? "No title"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onEdit(contact)}
              >
                <Pencil aria-hidden="true" className="size-3.5" />
                Edit
              </Button>
              {contact.archived ? (
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
              aria-label="Confirm archive contact"
              className="rounded-card border border-danger/30 bg-danger/5 p-4"
            >
              <p className="text-sm font-medium text-fg">
                Archive this contact?
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                They leave active lists and can be restored from the Archived
                view.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => archive.mutate()}
                  loading={archive.isPending}
                >
                  Archive contact
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
              <dt className="label-micro">Email</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="inline-flex max-w-full items-center gap-1.5 text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{contact.email}</span>
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Phone</dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone}`}
                    className="inline-flex max-w-full items-center gap-1.5 text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{contact.phone}</span>
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Company</dt>
              <dd className="mt-1 text-sm text-fg">
                {contact.company ? (
                  <Link
                    to={`/app/companies/${contact.company.id}`}
                    className="inline-flex max-w-full items-center gap-1.5 text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Building2
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{contact.company.name}</span>
                  </Link>
                ) : (
                  <span className="text-muted">No company</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Owner</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm text-fg">
                {contact.owner ? (
                  <>
                    <Avatar
                      name={contact.owner.name}
                      src={contact.owner.avatarUrl}
                      size="xs"
                    />
                    <span className="truncate">{contact.owner.name}</span>
                  </>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Last activity</dt>
              <dd className="mt-1 text-sm text-fg">
                {relativeTime(contact.lastActivityAt)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label-micro">Added</dt>
              <dd className="mt-1 text-sm text-fg">
                {formatDate(contact.createdAt)}
              </dd>
            </div>
          </dl>

          <div>
            <p className="label-micro mb-2">Tags</p>
            {contact.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No tags yet.</p>
            )}
          </div>

          <section
            aria-labelledby="contact-deals-heading"
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="contact-deals-heading"
                className="text-sm font-medium text-fg"
              >
                Open deals
              </h3>
              <span className="num text-xs text-muted">
                {dealsQuery.data ? dealsQuery.data.meta.total : "—"}
              </span>
            </div>
            {dealsQuery.isPending ? (
              <div
                className="space-y-2"
                role="status"
                aria-label="Loading deals"
              >
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
                No open deals for this contact.
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
                        <span className="block truncate text-sm text-fg">
                          {deal.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {deal.stage.name}
                        </span>
                      </span>
                      <span className="num shrink-0 text-sm text-fg">
                        {formatMoney(deal.value, deal.currency)}
                      </span>
                      <Badge tone={stageTone[deal.stage.kind]}>
                        {deal.stage.kind}
                      </Badge>
                      <ArrowUpRight
                        className="size-3.5 shrink-0 text-muted"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ContactActivityTimeline contactId={contact.id} />
        </div>
      ) : null}
    </Modal>
  );
}
