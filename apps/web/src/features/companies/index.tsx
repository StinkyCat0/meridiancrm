import { api, type Company, type CustomerType } from "@meridian/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Plus, Search } from "lucide-react";
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_META,
  INDUSTRIES,
  type Industry,
} from "@meridian/contracts";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";
import { formatMoney, useDebouncedValue } from "../../lib/utils";
import { CompanyDetailSheet } from "./CompanyDetailSheet";
import { CompanyFormModal } from "./CompanyFormModal";
import { apiErrorMessage, toIndustry } from "./lib";

const PAGE_SIZE = 25;
type ArchiveView = "active" | "archived";

export default function CompaniesPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const selectedId = params["*"]?.split("/")[0] || null;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [industry, setIndustry] = useState<Industry | "">("");
  const [customerType, setCustomerType] = useState<CustomerType | "">("");
  const [archive, setArchive] = useState<ArchiveView>("active");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, industry, customerType, archive]);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setCreating(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const listQuery = {
    q: debouncedSearch.trim() || undefined,
    industry: industry || undefined,
    customerType: customerType || undefined,
    archive,
    page,
    pageSize: PAGE_SIZE,
  };

  const companiesQuery = useQuery({
    queryKey: queryKeys.companies.list(listQuery),
    queryFn: () => api.companies.list(listQuery),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const totalPages = companiesQuery.data?.meta.totalPages;
    if (totalPages && page > totalPages) setPage(totalPages);
  }, [companiesQuery.data, page]);

  const companies = companiesQuery.data?.data ?? [];
  const total = companiesQuery.data?.meta.total ?? 0;
  const totalPages = companiesQuery.data?.meta.totalPages ?? 1;
  const pageSize = companiesQuery.data?.meta.pageSize ?? PAGE_SIZE;
  const currentPage = companiesQuery.data?.meta.page ?? page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);
  const selectedCompany = companies.find((company) => company.id === selectedId) ?? null;
  const hasFilters = Boolean(search.trim() || industry || customerType || archive === "archived");

  function openCompany(id: string) {
    navigate(`/app/companies/${encodeURIComponent(id)}`);
  }

  function closeDetail() {
    navigate("/app/companies", { replace: true });
  }

  function clearFilters() {
    setSearch("");
    setIndustry("");
    setCustomerType("");
    setArchive("active");
  }

  function handleSaved(saved: Company) {
    setCreating(false);
    setEditing(null);
    navigate(`/app/companies/${encodeURIComponent(saved.id)}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="RECORDS"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Customers
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {companiesQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="The people and properties behind the work — contacts, sites, jobs and money."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" />
            New customer
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
              placeholder="Search customers by name, domain or email"
              aria-label="Search customers"
              className="pl-9"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={customerType}
              onChange={(event) =>
                setCustomerType(event.target.value as CustomerType | "")
              }
              aria-label="Filter by customer type"
              className="sm:w-40"
            >
              <option value="">All types</option>
              {CUSTOMER_TYPES.map((option) => (
                <option key={option} value={option}>
                  {CUSTOMER_TYPE_META[option].label}
                </option>
              ))}
            </Select>
            <Select
              value={industry}
              onChange={(event) => setIndustry(toIndustry(event.target.value))}
              aria-label="Filter by industry"
              className="sm:w-40"
            >
              <option value="">All industries</option>
              {INDUSTRIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Tabs
              ariaLabel="Company archive filter"
              items={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              value={archive}
              onChange={(value) => setArchive(value === "archived" ? "archived" : "active")}
              className="border-0"
            />
            <p aria-live="polite" className="num shrink-0 text-xs text-muted">
              {companiesQuery.isError
                ? "—"
                : companiesQuery.data
                  ? `${total} ${total === 1 ? "result" : "results"}`
                  : "Loading"}
            </p>
          </div>
        </div>
      </Card>

      {companiesQuery.isPending ? (
        <ListSkeleton />
      ) : companiesQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">Could not load customers.</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(companiesQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void companiesQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : companies.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={hasFilters ? "No customers match those filters." : "No customers yet."}
          description={
            hasFilters
              ? "Clear the filters or search for a different customer."
              : "Add the first customer and the locations your crews visit."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" />
                New customer
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
                      Customer
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Type
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Industry
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Contacts
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Open pipeline
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Owner
                    </th>
                    <th scope="col" className="label-micro px-4 py-3">
                      Tags
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr
                      key={company.id}
                      tabIndex={0}
                      aria-label={`Open ${company.name}`}
                      onClick={() => openCompany(company.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, company.id, openCompany)}
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={company.name} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-fg">{company.name}</p>
                              {company.archived ? (
                                <Badge tone="warning">Archived</Badge>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted">
                              {company.domain ?? "No domain"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={company.customerType === "COMMERCIAL" ? "accent" : "neutral"}>
                          {CUSTOMER_TYPE_META[company.customerType].short}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{company.industry ?? "—"}</td>
                      <td className="num px-4 py-3 text-fg">{company.contactCount}</td>
                      <td className="num whitespace-nowrap px-4 py-3 text-fg">
                        {formatMoney(company.openPipelineValue, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <OwnerCell
                          name={company.owner?.name}
                          avatarUrl={company.owner?.avatarUrl}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <CompanyTags tags={company.tags} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {companies.map((company) => (
              <div
                key={company.id}
                role="button"
                tabIndex={0}
                onClick={() => openCompany(company.id)}
                onKeyDown={(event) =>
                  handleCardKeyDown(event, company.id, openCompany)
                }
                aria-label={`Open ${company.name}`}
                className="w-full cursor-pointer rounded-card border border-border bg-surface p-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={company.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-fg">{company.name}</p>
                      {company.archived ? <Badge tone="warning">Archived</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {company.domain ?? "No domain"}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {company.industry ?? "No industry"}
                    </p>
                  </div>
                </div>
                {company.tags.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {company.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                    {company.tags.length > 3 ? (
                      <Badge tone="neutral">+{company.tags.length - 3}</Badge>
                    ) : null}
                  </div>
                ) : null}
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
                  <div>
                    <dt className="label-micro">Contacts</dt>
                    <dd className="num mt-0.5 text-fg">{company.contactCount}</dd>
                  </div>
                  <div>
                    <dt className="label-micro">Pipeline</dt>
                    <dd className="num mt-0.5 truncate text-fg">
                      {formatMoney(company.openPipelineValue, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-micro">Owner</dt>
                    <dd className="mt-0.5 truncate text-muted">
                      {company.owner?.name ?? "Unassigned"}
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
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
        <CompanyFormModal
          company={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
        />
      ) : null}

      {selectedId && !creating && !editing ? (
        <CompanyDetailSheet
          companyId={selectedId}
          initialCompany={selectedCompany}
          onClose={closeDetail}
          onEdit={(company) => setEditing(company)}
        />
      ) : null}
    </div>
  );
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  id: string,
  open: (companyId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function handleCardKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  id: string,
  open: (companyId: string) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open(id);
}

function CompanyTags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex max-w-[200px] flex-wrap gap-1">
      {tags.slice(0, 2).map((tag) => (
        <Badge key={tag}>{tag}</Badge>
      ))}
      {tags.length > 2 ? <Badge tone="neutral">+{tags.length - 2}</Badge> : null}
    </div>
  );
}

function OwnerCell({ name, avatarUrl }: { name?: string; avatarUrl?: string | null }) {
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
          <div key={row} className="rounded-card border border-border bg-surface p-4">
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
