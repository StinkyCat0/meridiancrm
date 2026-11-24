import { api } from "@meridian/api-client";
import type { StudioDemo } from "@meridian/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Eye, MonitorPlay } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { queryKeys } from "../../lib/query";
import { relativeTime } from "../../lib/utils";
import { StudioErrorCard, websiteUrl } from "./shared";

function DemosSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2"
      role="status"
      aria-label="Loading demo traffic"
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-48" />
      ))}
    </div>
  );
}

export default function StudioDemosPage() {
  const demosQuery = useQuery({
    queryKey: queryKeys.studio.demos,
    queryFn: () => api.studio.demos(),
  });

  const demos: StudioDemo[] = demosQuery.data?.items ?? [];
  const totalVisits = demos.reduce((sum, demo) => sum + demo.visits, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-light tracking-tight text-fg">Demos</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Public demo sites on meridianstudios.org and their visit counts.
          </p>
        </div>
        {demos.length > 0 ? (
          <p className="num text-sm text-muted">
            {totalVisits.toLocaleString()} total visits
          </p>
        ) : null}
      </div>

      {demosQuery.isPending ? (
        <DemosSkeleton />
      ) : demosQuery.isError ? (
        <StudioErrorCard
          title="Could not load demo traffic."
          error={demosQuery.error}
          onRetry={() => void demosQuery.refetch()}
        />
      ) : demos.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay />}
          title="No demos yet"
          description="Demo sites will appear here once the website reports them."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {demos.map((demo) => (
            <Card key={demo.key} className="flex flex-col">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>{demo.name}</CardTitle>
                  <CardDescription>{demo.description}</CardDescription>
                </div>
                <BadgePath path={demo.path} />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="label-micro">Visits</p>
                    <p className="num mt-1 text-3xl font-light tracking-tight text-fg">
                      {demo.visits.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="label-micro">Last visited</p>
                    <p className="mt-1.5 text-sm text-fg">
                      {demo.lastVisitedAt
                        ? relativeTime(demo.lastVisitedAt)
                        : "No visits yet"}
                    </p>
                  </div>
                </div>
                <a
                  href={websiteUrl(demo.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-input border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-fg transition-colors hover:border-white/15 hover:bg-surface-2/70"
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  Open live demo
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgePath({ path }: { path: string }) {
  return (
    <span className="num shrink-0 rounded-full border border-border bg-white/5 px-2 py-0.5 text-[10px] text-muted">
      {path}
    </span>
  );
}
