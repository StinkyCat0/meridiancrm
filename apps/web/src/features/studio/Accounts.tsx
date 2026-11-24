import { api } from "@meridian/api-client";
import type {
  StudioAccount,
  StudioAccountPage,
  StudioAccountUpdateInput,
} from "@meridian/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BadgeCheck, Building2, Search, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { queryKeys } from "../../lib/query";
import { formatDate, relativeTime, useDebouncedValue } from "../../lib/utils";
import { apiErrorMessage } from "../companies/lib";
import {
  humanize,
  planTone,
  StudioErrorCard,
  StudioPagination,
  StudioSwitch,
  subscriptionTone,
} from "./shared";

const PAGE_SIZE = 20;

function AccountsSkeleton() {
  return (
    <Card className="p-5" role="status" aria-label="Loading website accounts">
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function AccessLabel({ children }: { children: ReactNode }) {
  return <span className="label-micro text-muted">{children}</span>;
}

export default function StudioAccountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);

  const accountsQuery = useQuery({
    queryKey: queryKeys.studio.accounts({
      search: debouncedSearch || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    queryFn: () =>
      api.studio.accounts({
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const updateAccount = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: StudioAccountUpdateInput;
    }) => api.studio.updateAccount(id, input),
    onSuccess: () => {
      toast.success("Website account updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.studio.all });
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  const accountsPage: StudioAccountPage | undefined = accountsQuery.data;
  const accounts = accountsPage?.items ?? [];
  const pendingAccountId = updateAccount.isPending
    ? updateAccount.variables?.id
    : null;

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function patch(account: StudioAccount, input: StudioAccountUpdateInput) {
    updateAccount.mutate({ id: account.id, input });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-light tracking-tight text-fg">
            Website accounts
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Public identities live on meridianstudios.org. CRM roles and
            workspace access still come only from CRM memberships.
          </p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search name or email"
            aria-label="Search website accounts"
            className="pl-9"
          />
        </div>
      </div>

      {accountsQuery.isPending ? (
        <AccountsSkeleton />
      ) : accountsQuery.isError ? (
        <StudioErrorCard
          title="Could not load website accounts."
          error={accountsQuery.error}
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={
            debouncedSearch ? "No matching accounts" : "No website accounts yet"
          }
          description={
            debouncedSearch
              ? "Try a different name or email address."
              : "Accounts appear here once someone registers on the public website."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border">
            <div>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>
                Toggle CRM and chat access or deactivate an account. Website
                admin roles stay read-only.
              </CardDescription>
            </div>
            <span className="num text-xs text-muted">
              {accountsPage?.total ?? 0} total
            </span>
          </CardHeader>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="label-micro px-5 py-3">
                    Account
                  </th>
                  <th scope="col" className="label-micro px-3 py-3">
                    Access
                  </th>
                  <th scope="col" className="label-micro px-3 py-3">
                    Active
                  </th>
                  <th scope="col" className="label-micro px-3 py-3">
                    Subscription
                  </th>
                  <th scope="col" className="label-micro px-5 py-3">
                    Activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const pending = pendingAccountId === account.id;
                  return (
                    <tr
                      key={account.id}
                      className="border-b border-border/70 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={account.name || account.email}
                            src={account.avatar}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm text-fg">
                                {account.name || "Website member"}
                              </span>
                              {account.role === "admin" ? (
                                <Badge tone="violet">Website admin</Badge>
                              ) : null}
                              {account.isVerified ? (
                                <BadgeCheck
                                  className="size-3.5 text-success"
                                  aria-label="Verified email"
                                />
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted">
                              {account.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-5">
                          <div className="flex items-center gap-2">
                            <StudioSwitch
                              checked={account.access.canAccessCrm}
                              pending={pending}
                              label={`CRM access for ${account.email}`}
                              onChange={(value) =>
                                patch(account, { canAccessCrm: value })
                              }
                            />
                            <AccessLabel>CRM</AccessLabel>
                          </div>
                          <div className="flex items-center gap-2">
                            <StudioSwitch
                              checked={account.access.canAccessChat}
                              pending={pending}
                              label={`Chat access for ${account.email}`}
                              onChange={(value) =>
                                patch(account, { canAccessChat: value })
                              }
                            />
                            <AccessLabel>Chat</AccessLabel>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StudioSwitch
                          checked={account.isActive}
                          pending={pending}
                          label={`Account active for ${account.email}`}
                          onChange={(value) =>
                            patch(account, { isActive: value })
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={planTone(account.subscription.plan)}>
                            {humanize(account.subscription.plan)}
                          </Badge>
                          <Badge
                            tone={subscriptionTone(account.subscription.status)}
                          >
                            {humanize(account.subscription.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {account.subscription.cancelAtPeriodEnd
                            ? "Cancels at period end"
                            : account.subscription.currentPeriodEnd
                              ? `Renews ${formatDate(account.subscription.currentPeriodEnd)}`
                              : "No renewal date"}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 text-xs text-muted">
                          <ShieldCheck
                            className="size-3.5 text-muted"
                            aria-hidden="true"
                          />
                          <span>Joined {formatDate(account.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {account.lastLogin
                            ? `Last login ${relativeTime(account.lastLogin)}`
                            : "Never signed in"}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <StudioPagination
            page={accountsPage?.page ?? page}
            pageSize={accountsPage?.pageSize ?? PAGE_SIZE}
            total={accountsPage?.total ?? 0}
            onPage={setPage}
            disabled={accountsQuery.isFetching}
          />
        </Card>
      )}
    </div>
  );
}
