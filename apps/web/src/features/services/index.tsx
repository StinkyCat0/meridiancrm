import { api, type ServiceItem } from "@meridian/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tags,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  SERVICE_UNIT_META,
  type ServiceUnit,
} from "@meridian/contracts";
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
import { apiErrorMessage } from "../companies/lib";
import { ServiceFormModal } from "./ServiceFormModal";

type ArchiveView = "active" | "archived";

export default function ServicesPage() {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const currency = workspace?.currency ?? "USD";
  const [archive, setArchive] = useState<ArchiveView>("active");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState<ServiceUnit | "">("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);

  const servicesQuery = useQuery({
    queryKey: queryKeys.services.list({
      archive,
      q: debouncedSearch.trim() || undefined,
      category: category || undefined,
      unit: unit || undefined,
      pageSize: 100,
      sort: "name",
      order: "asc",
    }),
    queryFn: () =>
      api.services.list({
        archive,
        q: debouncedSearch.trim() || undefined,
        category: category || undefined,
        unit: unit || undefined,
        pageSize: 100,
        sort: "name",
        order: "asc",
      }),
  });

  const allQuery = useQuery({
    queryKey: queryKeys.services.list({ archive: "all", pageSize: 100 }),
    queryFn: () => api.services.list({ archive: "all", pageSize: 100 }),
    staleTime: 60_000,
  });

  const services = servicesQuery.data?.data ?? [];
  const total = servicesQuery.data?.meta.total ?? 0;
  const categories = Array.from(
    new Set((allQuery.data?.data ?? []).map((item) => item.category).filter(Boolean)),
  ).sort() as string[];
  const hasFilters = Boolean(search.trim() || category || unit || archive === "archived");

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.services.all });
  }

  const archiveService = useMutation({
    mutationFn: (id: string) => api.services.archive(id),
    onSuccess: () => {
      invalidate();
      toast.success("Service archived");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const restoreService = useMutation({
    mutationFn: (id: string) => api.services.restore(id),
    onSuccess: () => {
      invalidate();
      toast.success("Service restored");
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function clearFilters() {
    setSearch("");
    setCategory("");
    setUnit("");
    setArchive("active");
  }

  const busy = archiveService.isPending || restoreService.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="PRICE BOOK"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Services
            <span className="num rounded-full border border-border bg-white/5 px-2 py-0.5 text-xs font-medium text-muted">
              {servicesQuery.data ? total : "—"}
            </span>
          </span>
        }
        description="Standard scopes and prices so every quote starts from the same book."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New service
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
              placeholder="Search the price book"
              aria-label="Search services"
              className="pl-9"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Filter by category"
              className="sm:w-40"
            >
              <option value="">All categories</option>
              {categories.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Select
              value={unit}
              onChange={(event) => setUnit(event.target.value as ServiceUnit | "")}
              aria-label="Filter by unit"
              className="sm:w-40"
            >
              <option value="">All units</option>
              {(Object.keys(SERVICE_UNIT_META) as ServiceUnit[]).map((option) => (
                <option key={option} value={option}>
                  {SERVICE_UNIT_META[option].label}
                </option>
              ))}
            </Select>
            <Tabs
              ariaLabel="Service archive filter"
              items={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              value={archive}
              onChange={(value) => setArchive(value === "archived" ? "archived" : "active")}
              className="border-0"
            />
            <p aria-live="polite" className="num shrink-0 text-xs text-muted">
              {servicesQuery.data ? `${total} total` : "Loading"}
            </p>
          </div>
        </div>
      </Card>

      {servicesQuery.isPending ? (
        <ListSkeleton />
      ) : servicesQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-fg">Could not load the price book.</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              {apiErrorMessage(servicesQuery.error)}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void servicesQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </Card>
      ) : services.length === 0 ? (
        <EmptyState
          icon={<Tags />}
          title={hasFilters ? "No services match those filters." : "The price book is empty."}
          description={
            hasFilters
              ? "Clear the filters or search for a different service."
              : "Add the scopes your crews sell most often."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden="true" />
                New service
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="label-micro px-4 py-3">
                    Service
                  </th>
                  <th scope="col" className="label-micro px-4 py-3">
                    Category
                  </th>
                  <th scope="col" className="label-micro px-4 py-3">
                    Unit
                  </th>
                  <th scope="col" className="label-micro px-4 py-3 text-right">
                    Price
                  </th>
                  <th scope="col" className="label-micro px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr
                    key={service.id}
                    className="border-b border-border/70 transition-colors last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-fg">{service.name}</p>
                        {service.taxable ? <Badge tone="neutral">Taxable</Badge> : null}
                        {service.archived ? <Badge tone="warning">Archived</Badge> : null}
                      </div>
                      {service.description ? (
                        <p className="mt-0.5 max-w-[360px] truncate text-xs text-muted">
                          {service.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{service.category ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {SERVICE_UNIT_META[service.unit].label}
                      <span className="num text-xs text-muted/70"> · {service.durationMinutes} min</span>
                    </td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-fg">
                      {formatMoney(service.price, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(service)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                        {service.archived ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => restoreService.mutate(service.id)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            Restore
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => archiveService.mutate(service.id)}
                          >
                            <Archive className="size-3.5" aria-hidden="true" />
                            Archive
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating || editing ? (
        <ServiceFormModal
          service={editing}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="divide-y divide-border">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-3 w-24 lg:block" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
