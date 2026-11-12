import { api, type Contact } from "@meridian/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search, Users } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { queryKeys } from "../../lib/query";
import { relativeTime, useDebouncedValue } from "../../lib/utils";
import { ContactDetailSheet } from "./ContactDetailSheet";
import { ContactFormModal } from "./ContactFormModal";
import { apiErrorMessage, contactName } from "./lib";

const PAGE_SIZE = 25;
type ArchiveView = "active" | "archived";

export default function ContactsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const selectedId = params["*"]?.split("/")[0] || null;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [companyId, setCompanyId] = useState("");
  const [archive, setArchive] = useState<ArchiveView>("active");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, companyId, archive]);

  const listQuery = {
    q: debouncedSearch.trim() || undefined,
    companyId: companyId || undefined,
    archive,
    page,
    pageSize: PAGE_SIZE,
  };

  const contactsQuery = useQuery({
    queryKey: queryKeys.contacts.list(listQuery),
    queryFn: () => api.contacts.list(listQuery),
    placeholderData: keepPreviousData,
  });

  const companiesQuery = useQuery({
    queryKey: queryKeys.companies.list({ pageSize: 100 }),
    queryFn: () => api.companies.list({ pageSize: 100 }),
  });

  useEffect(() => {
    const totalPages = contactsQuery.data?.meta.totalPages;
    if (totalPages && page > totalPages) setPage(totalPages);
  }, [contactsQuery.data, page]);

  const contacts = contactsQuery.data?.data ?? [];
  const total = contactsQuery.data?.meta.total ?? 0;
  const totalPages = contactsQuery.data?.meta.totalPages ?? 1;
  const pageSize = contactsQuery.data?.meta.pageSize ?? PAGE_SIZE;
  const currentPage = contactsQuery.data?.meta.page ?? page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);
  const selectedContact =
    contacts.find((contact) => contact.id === selectedId) ?? null;
  const hasFilters = Boolean(
    search.trim() || companyId || archive === "archived",
  );

  function openContact(id: string) {
    navigate(`/app/contacts/${encodeURIComponent(id)}`);
  }

  function closeDetail() {
    navigate("/app/contacts", { replace: true });
  }

  function clearFilters() {
    setSearch("");
    setCompanyId("");
    setArchive("active");
  }

  function handleSaved(saved: Contact) {
    setCreating(false);
    setEditing(null);
    navigate(`/app/contacts/${encodeURIComponent(saved.id)}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="RECORDS"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Contacts
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {contactsQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="Every person in the studio's orbit — context, conversations and the deals they carry."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" />
            New contact
          </Button>
        }
      />

      <Card className="p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contacts by name or email"
              aria-label="Search contacts"
              className="pl-9"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              aria-label="Filter by company"
              className="sm:w-52"
              disabled={companiesQuery.isPending}
            >
              <option value="">All companies</option>
              {(companiesQuery.data?.data ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
            <Tabs
              ariaLabel="Contact archive filter"
              items={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              value={archive}
              onChange={(value) =>
                setArchive(value === "archived" ? "archived" : "active")
              }
              className="border-0"
            />
            <p aria-live="polite" className="num shrink-0 text-xs text-muted">
              {contactsQuery.isError
                ? "—"
                : contactsQuery.data
                  ? `${total} ${total === 1 ? "result" : "results"}`
                  : "Loading"}
            </p>
          </div>
        </div>
      </Card>

      {contactsQuery.isPending ? (
        <ListSkeleton />
      ) : contactsQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">
              Could not load contacts.
            </p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(contactsQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void contactsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={
            hasFilters ? "No contacts match those filters." : "No contacts yet."
          }
          description={
            hasFilters
              ? "Clear the filters or search for a different name."
              : "Add the first person you want the studio to remember."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" />
                New contact
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-4 py-3">
                      Contact
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Email
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Company
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Tags
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Open deals
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Last activity
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Owner
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      tabIndex={0}
                      aria-label={`Open ${contactName(contact)}`}
                      onClick={() => openContact(contact.id)}
                      onKeyDown={(event) =>
                        handleRowKeyDown(event, contact.id, openContact)
                      }
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={contactName(contact)} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-fg">
                                {contactName(contact)}
                              </p>
                              {contact.archived ? (
                                <Badge tone="warning">Archived</Badge>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted">
                              {contact.title ?? "No title"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[190px] truncate px-4 py-3 text-muted">
                        {contact.email ?? "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted">
                        {contact.company?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <ContactTags tags={contact.tags} />
                      </td>
                      <td className="num px-4 py-3 text-fg">
                        {contact.openDealCount}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {relativeTime(contact.lastActivityAt)}
                      </td>
                      <td className="px-4 py-3">
                        <OwnerCell
                          name={contact.owner?.name}
                          avatarUrl={contact.owner?.avatarUrl}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                role="button"
                tabIndex={0}
                onClick={() => openContact(contact.id)}
                onKeyDown={(event) =>
                  handleCardKeyDown(event, contact.id, openContact)
                }
                aria-label={`Open ${contactName(contact)}`}
                className="w-full cursor-pointer rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={contactName(contact)} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-fg">
                        {contactName(contact)}
                      </p>
                      {contact.archived ? (
                        <Badge tone="warning">Archived</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {contact.title ?? "No title"}
                      {contact.company ? ` · ${contact.company.name}` : ""}
                    </p>
                    {contact.email ? (
                      <p className="mt-1 truncate text-xs text-muted">
                        {contact.email}
                      </p>
                    ) : null}
                  </div>
                </div>
                {contact.tags.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {contact.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                    {contact.tags.length > 3 ? (
                      <Badge tone="neutral">+{contact.tags.length - 3}</Badge>
                    ) : null}
                  </div>
                ) : null}
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
                  <div>
                    <dt className="label-micro">Deals</dt>
                    <dd className="num mt-0.5 text-fg">
                      {contact.openDealCount} open
                    </dd>
                  </div>
                  <div>
                    <dt className="label-micro">Activity</dt>
                    <dd className="mt-0.5 truncate text-muted">
                      {relativeTime(contact.lastActivityAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-micro">Owner</dt>
                    <dd className="mt-0.5 truncate text-muted">
                      {contact.owner?.name ?? "Unassigned"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="num text-xs text-muted">
              Showing {rangeStart}–{rangeEnd} of {total}
            </p>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="num text-xs text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {creating || editing ? (
        <ContactFormModal
          contact={editing}
          companies={companiesQuery.data?.data ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      ) : null}

      {selectedId && !creating && !editing ? (
        <ContactDetailSheet
          contactId={selectedId}
          initialContact={selectedContact}
          onClose={closeDetail}
          onEdit={(contact) => setEditing(contact)}
        />
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  id: string,
  open: (contactId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function handleCardKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  id: string,
  open: (contactId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function ContactTags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex max-w-[200px] flex-wrap gap-1">
      {tags.slice(0, 2).map((tag) => (
        <Badge key={tag}>{tag}</Badge>
      ))}
      {tags.length > 2 ? (
        <Badge tone="neutral">+{tags.length - 2}</Badge>
      ) : null}
    </div>
  );
}

function OwnerCell({
  name,
  avatarUrl,
}: {
  name?: string;
  avatarUrl?: string | null;
}) {
  if (!name) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-2">
      <Avatar name={name} src={avatarUrl} size="xs" />
      <span className="max-w-[120px] truncate text-muted">{name}</span>
    </span>
  );
}

function ListSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="hidden h-3 w-32 lg:block" />
              <Skeleton className="hidden h-3 w-24 xl:block" />
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
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </>
  );
}
