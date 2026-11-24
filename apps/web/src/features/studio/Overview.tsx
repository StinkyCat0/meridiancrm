import { api } from "@meridian/api-client";
import type { StudioOverview } from "@meridian/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  ChevronRight,
  Eye,
  Globe2,
  Mail,
  MessageSquare,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { queryKeys } from "../../lib/query";
import { formatDateTime } from "../../lib/utils";
import {
  integrationTone,
  StudioErrorCard,
  STUDIO_WEBSITE_ORIGIN,
} from "./shared";

const QUICK_LINKS = [
  {
    to: "/app/studio/accounts",
    label: "Accounts",
    description: "Website identities, access and activation.",
    icon: Building2,
  },
  {
    to: "/app/studio/inquiries",
    label: "Inquiries",
    description: "Contact form submissions and their status.",
    icon: Mail,
  },
  {
    to: "/app/studio/chat",
    label: "Chat",
    description: "Live rooms, moderation and replies.",
    icon: MessageSquare,
  },
  {
    to: "/app/studio/billing",
    label: "Billing",
    description: "Subscription plans and payment state.",
    icon: Sparkles,
  },
  {
    to: "/app/studio/demos",
    label: "Demos",
    description: "Traffic across the public demo sites.",
    icon: Eye,
  },
  {
    to: "/app/studio/settings",
    label: "Settings",
    description: "Integration health and website links.",
    icon: Settings2,
  },
] as const;

function OverviewSkeleton() {
  return (
    <div
      className="space-y-5"
      role="status"
      aria-label="Loading Studio overview"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}

export default function StudioOverviewPage() {
  const overviewQuery = useQuery({
    queryKey: queryKeys.studio.overview,
    queryFn: () => api.studio.overview(),
  });

  const overview: StudioOverview | undefined = overviewQuery.data;

  if (overviewQuery.isPending) return <OverviewSkeleton />;

  if (overviewQuery.isError || !overview) {
    return (
      <StudioErrorCard
        title="Could not load the Studio overview."
        error={overviewQuery.error}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const demoVisits = overview.demos.reduce((sum, demo) => sum + demo.visits, 0);
  const verifiedShare =
    overview.accounts.total > 0
      ? Math.round((overview.accounts.verified / overview.accounts.total) * 100)
      : 0;

  const integrations = [
    { label: "MongoDB", status: overview.integrations.mongo },
    { label: "Email delivery", status: overview.integrations.email },
    { label: "CRM intake", status: overview.integrations.crmIntake },
    { label: "CRM handoff", status: overview.integrations.crmHandoff },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Website accounts"
          value={overview.accounts.total}
          hint={`${overview.accounts.active} active · ${overview.accounts.admins} admins`}
          icon={<Building2 />}
        />
        <StatCard
          label="Verified accounts"
          value={overview.accounts.verified}
          hint={`${verifiedShare}% of all accounts`}
          icon={<BadgeCheck />}
        />
        <StatCard
          label="CRM access"
          value={overview.accounts.crmAccess}
          hint="Website accounts allowed into the CRM"
          icon={<Globe2 />}
        />
        <StatCard
          label="New inquiries"
          value={overview.inquiries.new}
          hint={`${overview.inquiries.last7Days} in the last 7 days`}
          icon={<Mail />}
        />
        <StatCard
          label="Chat messages"
          value={overview.chat.messages7Days}
          hint={`${overview.chat.rooms} rooms · ${overview.chat.messages} total`}
          icon={<MessageSquare />}
        />
        <StatCard
          label="Demo visits"
          value={demoVisits}
          hint="Across all public demo sites"
          icon={<Eye />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Integration health</CardTitle>
              <CardDescription>
                The bridge between meridianstudios.org and this CRM.
              </CardDescription>
            </div>
            <Badge tone="neutral">{formatDateTime(overview.generatedAt)}</Badge>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {integrations.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface-2/40 px-3 py-2.5"
                >
                  <span className="text-sm text-fg">{item.label}</span>
                  <Badge tone={integrationTone(item.status)}>
                    {item.status}
                  </Badge>
                </li>
              ))}
            </ul>
            <a
              href={STUDIO_WEBSITE_ORIGIN}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
            >
              Open public website
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quick links</CardTitle>
              <CardDescription>
                Jump into the Studio surfaces that need attention.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="group flex items-start gap-3 rounded-input border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-2/50"
                >
                  <span
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2 text-muted group-hover:text-accent [&_svg]:size-4"
                    aria-hidden="true"
                  >
                    <link.icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm text-fg">
                      {link.label}
                      <ChevronRight
                        className="size-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {link.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Subscription mix</CardTitle>
            <CardDescription>
              Plan distribution across every website account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ["Free", overview.subscriptions.free],
                ["Basic", overview.subscriptions.basic],
                ["Pro", overview.subscriptions.pro],
                ["Enterprise", overview.subscriptions.enterprise],
                ["Past due", overview.subscriptions.pastDue],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="label-micro">{label}</dt>
                <dd className="num mt-1 text-xl font-light text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
