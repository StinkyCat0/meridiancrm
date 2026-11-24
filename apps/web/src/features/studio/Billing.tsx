import { api } from "@meridian/api-client";
import type { StudioBillingPage } from "@meridian/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCard, RefreshCw, TrendingDown, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { queryKeys } from "../../lib/query";
import { formatDate } from "../../lib/utils";
import {
  humanize,
  planTone,
  StudioErrorCard,
  StudioPagination,
  subscriptionTone,
} from "./shared";

const PAGE_SIZE = 20;

function BillingSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading billing">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export default function StudioBillingView() {
  const [page, setPage] = useState(1);

  const billingQuery = useQuery({
    queryKey: queryKeys.studio.billing({ page, pageSize: PAGE_SIZE }),
    queryFn: () => api.studio.billing({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const billing: StudioBillingPage | undefined = billingQuery.data;

  if (billingQuery.isPending) return <BillingSkeleton />;

  if (billingQuery.isError || !billing) {
    return (
      <StudioErrorCard
        title="Could not load website billing."
        error={billingQuery.error}
        onRetry={() => void billingQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-light tracking-tight text-fg">Billing</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          A read-only mirror of website subscriptions. Checkout and plan changes
          stay on meridianstudios.org.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Subscriptions"
          value={billing.summary.total}
          hint="All website accounts"
          icon={<Users />}
        />
        <StatCard
          label="Active"
          value={billing.summary.active}
          hint="Paying or trialing"
          icon={<CreditCard />}
        />
        <StatCard
          label="Past due"
          value={billing.summary.pastDue}
          hint="Needs payment attention"
          icon={<TrendingDown />}
        />
        <StatCard
          label="Canceling"
          value={billing.summary.canceling}
          hint="Cancel at period end"
          icon={<RefreshCw />}
        />
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div>
            <CardTitle>Plan mix</CardTitle>
            <CardDescription>
              Distribution of the website subscription plans.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          {(
            [
              ["Free", billing.summary.plans.free, "free"],
              ["Basic", billing.summary.plans.basic, "basic"],
              ["Pro", billing.summary.plans.pro, "pro"],
              ["Enterprise", billing.summary.plans.enterprise, "enterprise"],
            ] as const
          ).map(([label, value, plan]) => (
            <div key={label}>
              <dt className="label-micro">{label}</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="num text-2xl font-light text-fg">{value}</span>
                <Badge tone={planTone(plan)}>{label}</Badge>
              </dd>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border">
          <div>
            <CardTitle>Subscriptions</CardTitle>
            <CardDescription>
              {billing.total} website{" "}
              {billing.total === 1 ? "subscription" : "subscriptions"}.
            </CardDescription>
          </div>
        </CardHeader>

        {billing.items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<CreditCard />}
              title="No subscriptions yet"
              description="Website subscriptions appear here once an account picks a plan."
              className="border-0 bg-transparent"
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="label-micro px-5 py-3">
                      Account
                    </th>
                    <th scope="col" className="label-micro px-3 py-3">
                      Plan
                    </th>
                    <th scope="col" className="label-micro px-3 py-3">
                      Status
                    </th>
                    <th scope="col" className="label-micro px-3 py-3">
                      Period end
                    </th>
                    <th scope="col" className="label-micro px-5 py-3">
                      Since
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {billing.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-border/70 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <p className="truncate text-sm text-fg">{item.name}</p>
                        <p className="truncate text-xs text-muted">
                          {item.email}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={planTone(item.plan)}>
                          {humanize(item.plan)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={subscriptionTone(item.status)}>
                          {humanize(item.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <span className="num text-xs text-muted">
                          {item.currentPeriodEnd
                            ? formatDate(item.currentPeriodEnd)
                            : "—"}
                        </span>
                        {item.cancelAtPeriodEnd ? (
                          <p className="mt-0.5 text-[11px] text-warning">
                            Cancels at period end
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        <span className="num text-xs text-muted">
                          {formatDate(item.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <StudioPagination
              page={billing.page}
              pageSize={billing.pageSize}
              total={billing.total}
              onPage={setPage}
              disabled={billingQuery.isFetching}
            />
          </>
        )}
      </Card>
    </div>
  );
}
