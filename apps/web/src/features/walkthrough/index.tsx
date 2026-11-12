import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  FileText,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Receipt,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";

interface WalkthroughLink {
  label: string;
  to: string;
}

interface WalkthroughStep {
  title: string;
  description: string;
  to: string;
  cta: string;
  icon: LucideIcon;
  extras?: readonly WalkthroughLink[];
}

const STEPS: readonly WalkthroughStep[] = [
  {
    title: "Read the day",
    description:
      "Start on Overview: today's route, collected cash and the tasks due. Pipeline analytics come second.",
    to: "/app",
    cta: "Open overview",
    icon: LayoutDashboard,
  },
  {
    title: "Set up the book",
    description:
      "Open a seeded customer to see sites, contacts and the Customer 360 timeline. Keep prices current in the price book.",
    to: "/app/companies",
    cta: "Open customers",
    extras: [{ label: "Price book", to: "/app/services" }],
    icon: Building2,
  },
  {
    title: "Quote the work",
    description:
      "Approve a seeded estimate and convert it into a job with line items and totals intact.",
    to: "/app/estimates",
    cta: "Open quotes",
    icon: FileText,
  },
  {
    title: "Run the day",
    description:
      "Balance the dispatch board, bulk-assign work and open a technician's optimized route.",
    to: "/app/dispatch",
    cta: "Open dispatch",
    extras: [{ label: "Calendar", to: "/app/calendar" }],
    icon: MapPinned,
  },
  {
    title: "Follow up",
    description:
      "Log a call, text or email and draft the follow-up locally. Nothing is sent to the customer.",
    to: "/app/inbox",
    cta: "Open inbox",
    icon: MessageSquare,
  },
  {
    title: "Get paid",
    description:
      "Record a payment, let the ledger settle the invoice, then review margin and aging in Revenue.",
    to: "/app/invoices",
    cta: "Open invoices",
    extras: [{ label: "Revenue", to: "/app/revenue" }],
    icon: Receipt,
  },
  {
    title: "Automate and review",
    description:
      "Check the rules and runs, then use Intelligence and Team to decide what needs attention next.",
    to: "/app/automations",
    cta: "Open automations",
    extras: [
      { label: "Intelligence", to: "/app/intelligence" },
      { label: "Team", to: "/app/team" },
    ],
    icon: Zap,
  },
];

const linkFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export default function WalkthroughPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="GUIDE"
        title="Product walkthrough"
        description="Seven screens from the first visit to the collected payment. Each step opens the real surface."
        actions={
          <Button variant="secondary" onClick={() => navigate("/app")}>
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Back to overview
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 border-accent/20 bg-accent/[0.04] p-4">
        <p className="text-sm leading-relaxed text-fg">
          Use the seeded Meridian Home Services workspace. Every record named in
          the full reference is already there.
        </p>
        <span className="label-micro shrink-0">7 steps</span>
      </Card>

      <ol aria-label="Walkthrough steps" className="grid gap-3 md:grid-cols-2">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-accent">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-medium tracking-tight text-fg">
                        {step.title}
                      </h2>
                      <span className="num text-[10px] text-muted">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {step.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Link
                        to={step.to}
                        className={`inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-fg ${linkFocus}`}
                      >
                        {step.cta}
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                      {step.extras?.map((extra) => (
                        <Link
                          key={extra.to}
                          to={extra.to}
                          className={`text-xs font-medium text-muted transition-colors hover:text-fg ${linkFocus}`}
                        >
                          {extra.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <BookOpen className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">
              Need the long version?
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              The full walkthrough in <code>docs/TUTORIAL.md</code> covers the
              seeded records, role boundaries, API and troubleshooting.
            </p>
          </div>
        </div>
        <a
          href="https://github.com/StinkyCat0/meridiancrm/blob/main/docs/TUTORIAL.md"
          target="_blank"
          rel="noreferrer"
          className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-fg ${linkFocus}`}
        >
          Open the full reference
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </Card>
    </div>
  );
}
