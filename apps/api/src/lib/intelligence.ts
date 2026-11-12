import type { Prisma } from "@prisma/client";
import {
  OPEN_JOB_STATUSES,
  RECOMMENDATION_KINDS,
  churnRiskScore,
  noShowRiskScore,
  upsellScore,
  type AssistantBrief,
  type CustomerSummary,
  type IntelligenceHealth,
  type IntelligenceSummary,
  type Recommendation,
  type RecommendationKind,
  type RecommendationSeverity,
  type RevenueForecast,
  type UpsellOpportunity,
} from "@meridian/contracts";
import { prisma } from "./db.js";
import { customerSelect, toCustomerSummary } from "./service-ops.js";

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
const NINETY_DAYS_MS = 90 * DAY_MS;
const SEVEN_DAYS_MS = 7 * DAY_MS;

const OPEN_STATUSES = [...OPEN_JOB_STATUSES];
const OPEN_INVOICE_STATUSES = ["SENT", "PARTIAL"];
const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  INFO: 1,
};

/** Per-kind output caps keep a pathological workspace from flooding the feed. */
const KIND_CAPS: Record<RecommendationKind, number> = {
  COLLECTIONS: 10,
  CHURN_RISK: 10,
  NO_SHOW_RISK: 10,
  UPSELL: 10,
  REVIEW_REQUEST: 10,
  STAFFING: 1,
  QUOTE_FOLLOW_UP: 10,
  REVENUE_FORECAST: 1,
  ROUTE: 3,
};

const LIST_LIMITS = {
  invoices: 1000,
  upcomingJobs: 200,
  completedJobs: 800,
  services: 200,
  recentCompleted: 100,
  staleEstimates: 50,
  openDeals: 500,
  reviewCommunications: 500,
  recentCommunications: 500,
  unassignedJobs: 25,
};

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY_MS));
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Math.round(cents) / 100);
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function severityForScore(score: number): RecommendationSeverity {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "INFO";
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function agreement(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function sortRecommendations(rows: Recommendation[]): Recommendation[] {
  return [...rows].sort((left, right) => {
    const severity = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severity !== 0) return severity;
    const value = (right.value ?? 0) - (left.value ?? 0);
    if (value !== 0) return value;
    return left.id.localeCompare(right.id);
  });
}

function capByKind(rows: Recommendation[]): Recommendation[] {
  const buckets = new Map<RecommendationKind, Recommendation[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.kind) ?? [];
    bucket.push(row);
    buckets.set(row.kind, bucket);
  }
  const capped: Recommendation[] = [];
  for (const [kind, bucket] of buckets) {
    capped.push(...sortRecommendations(bucket).slice(0, KIND_CAPS[kind]));
  }
  return sortRecommendations(capped);
}

export function filterRecommendations(
  rows: Recommendation[],
  query: { kind?: RecommendationKind; limit: number },
): Recommendation[] {
  const filtered = query.kind ? rows.filter((row) => row.kind === query.kind) : rows;
  return filtered.slice(0, query.limit);
}

interface CustomerRollup {
  customer: CustomerSummary;
  completedCount: number;
  revenueLastYear: number;
  lastCompletedAt: Date;
  lastServiceAt: Date | null;
}

interface OverdueRow {
  id: string;
  number: string;
  customerId: string;
  customer: CustomerSummary;
  amount: number;
  amountPaid: number;
  dueAt: Date | null;
}

export async function buildIntelligenceSummary(
  workspaceId: string,
  now = new Date(),
): Promise<IntelligenceSummary> {
  const startOfToday = utcDayStart(now);
  const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const yearAgo = new Date(now.getTime() - YEAR_MS);
  const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
  const weekAhead = new Date(now.getTime() + SEVEN_DAYS_MS);

  const staleEstimateWhere: Prisma.EstimateWhereInput = {
    workspaceId,
    status: "SENT",
    customer: { archived: false },
    OR: [{ issuedAt: { lt: sevenDaysAgo } }, { issuedAt: null, createdAt: { lt: sevenDaysAgo } }],
  };

  const [
    workspace,
    openInvoices,
    overdueAggregate,
    upcomingJobs,
    openCustomerRows,
    completedJobs,
    lifetimeCounts,
    purchasedLineItems,
    activeServices,
    priorOutcomes,
    recentCompleted,
    reviewCommunications,
    recentCommunications,
    staleEstimates,
    staleEstimateCount,
    openDeals,
    recurringAggregate,
    unbilledJobs,
    unassignedToday,
    unassignedTodayJobs,
    unassignedAggregate,
    scheduledAggregate,
  ] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } }),
    prisma.invoice.findMany({
      where: {
        workspaceId,
        status: { in: OPEN_INVOICE_STATUSES },
        customer: { archived: false },
      },
      select: {
        id: true,
        number: true,
        customerId: true,
        customer: { select: customerSelect },
        amount: true,
        amountPaid: true,
        dueAt: true,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: LIST_LIMITS.invoices,
    }),
    prisma.invoice.aggregate({
      where: {
        workspaceId,
        status: { in: OPEN_INVOICE_STATUSES },
        dueAt: { lt: now },
        customer: { archived: false },
      },
      _sum: { amount: true, amountPaid: true },
    }),
    prisma.job.findMany({
      where: {
        workspaceId,
        status: { in: OPEN_STATUSES },
        scheduledStart: { gte: now },
        customer: { archived: false },
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        customerId: true,
        customer: { select: customerSelect },
        scheduledStart: true,
        total: true,
        assigneeId: true,
      },
      orderBy: [{ scheduledStart: "asc" }, { number: "asc" }],
      take: LIST_LIMITS.upcomingJobs,
    }),
    prisma.job.findMany({
      where: { workspaceId, status: { in: OPEN_STATUSES } },
      select: { customerId: true },
      distinct: ["customerId"],
      take: 2000,
    }),
    prisma.job.findMany({
      where: {
        workspaceId,
        status: "COMPLETED",
        completedAt: { gte: yearAgo },
        customer: { archived: false },
      },
      select: {
        id: true,
        customerId: true,
        customer: { select: customerSelect },
        completedAt: true,
        total: true,
      },
      orderBy: { completedAt: "desc" },
      take: LIST_LIMITS.completedJobs,
    }),
    prisma.job.groupBy({
      by: ["customerId"],
      where: { workspaceId },
      _count: { _all: true },
      orderBy: { customerId: "asc" },
      take: 2000,
    }),
    prisma.jobLineItem.findMany({
      where: { job: { workspaceId }, serviceId: { not: null } },
      select: { serviceId: true, job: { select: { customerId: true } } },
      take: 10_000,
    }),
    prisma.serviceItem.findMany({
      where: { workspaceId, archived: false },
      select: { id: true, name: true, price: true, cost: true, category: true },
      orderBy: [{ price: "desc" }, { name: "asc" }],
      take: LIST_LIMITS.services,
    }),
    prisma.job.groupBy({
      by: ["customerId", "status"],
      where: { workspaceId, status: { in: ["NO_SHOW", "CANCELED"] } },
      _count: { _all: true },
      orderBy: [{ customerId: "asc" }, { status: "asc" }],
      take: 2000,
    }),
    prisma.job.findMany({
      where: {
        workspaceId,
        status: "COMPLETED",
        completedAt: { gte: sevenDaysAgo },
        customer: { archived: false },
      },
      select: {
        id: true,
        number: true,
        customerId: true,
        customer: { select: customerSelect },
        total: true,
        completedAt: true,
      },
      orderBy: { completedAt: "desc" },
      take: LIST_LIMITS.recentCompleted,
    }),
    prisma.communication.findMany({
      where: { workspaceId, intent: "REVIEW", jobId: { not: null } },
      select: { jobId: true },
      take: LIST_LIMITS.reviewCommunications,
    }),
    prisma.communication.findMany({
      where: {
        workspaceId,
        occurredAt: { gte: sevenDaysAgo },
        jobId: { not: null },
        OR: [{ intent: { in: ["REMINDER", "RESCHEDULE"] } }, { status: "RECEIVED" }],
      },
      select: { jobId: true },
      take: LIST_LIMITS.recentCommunications,
    }),
    prisma.estimate.findMany({
      where: staleEstimateWhere,
      select: {
        id: true,
        number: true,
        title: true,
        customerId: true,
        customer: { select: customerSelect },
        total: true,
        issuedAt: true,
        createdAt: true,
      },
      orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
      take: LIST_LIMITS.staleEstimates,
    }),
    prisma.estimate.count({ where: staleEstimateWhere }),
    prisma.deal.findMany({
      where: { workspaceId, stage: { kind: "OPEN" } },
      select: { value: true, stage: { select: { probability: true } } },
      take: LIST_LIMITS.openDeals,
    }),
    prisma.job.aggregate({
      where: {
        workspaceId,
        status: "COMPLETED",
        recurrence: { not: null },
        completedAt: { gte: ninetyDaysAgo },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.job.count({
      where: {
        workspaceId,
        status: "COMPLETED",
        invoices: { none: { status: { in: ["SENT", "PARTIAL", "PAID"] } } },
      },
    }),
    prisma.job.count({
      where: {
        workspaceId,
        status: { in: OPEN_STATUSES },
        scheduledStart: { gte: startOfToday, lt: endOfToday },
        assigneeId: null,
      },
    }),
    prisma.job.findMany({
      where: {
        workspaceId,
        status: { in: OPEN_STATUSES },
        scheduledStart: { gte: startOfToday, lt: endOfToday },
        assigneeId: null,
      },
      select: { id: true, number: true, title: true, total: true },
      orderBy: { scheduledStart: "asc" },
      take: LIST_LIMITS.unassignedJobs,
    }),
    prisma.job.aggregate({
      where: {
        workspaceId,
        status: { in: OPEN_STATUSES },
        scheduledStart: { gte: startOfToday, lt: endOfToday },
        assigneeId: null,
      },
      _sum: { total: true },
    }),
    prisma.job.aggregate({
      where: {
        workspaceId,
        status: { in: OPEN_STATUSES },
        scheduledStart: { gte: now, lt: endOfMonth },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const currency = workspace?.currency ?? "USD";
  const money = (cents: number) => formatMoney(cents, currency);
  const recommendations: Recommendation[] = [];
  const createdAt = now.toISOString();

  /* ---------------------------------------------------------------- invoices */
  const overdueByCustomer = new Map<string, OverdueRow[]>();
  for (const invoice of openInvoices) {
    if (invoice.amount <= invoice.amountPaid) continue;
    if (!invoice.dueAt || invoice.dueAt >= now) continue;
    const rows = overdueByCustomer.get(invoice.customerId) ?? [];
    rows.push({
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customer: toCustomerSummary(invoice.customer),
      amount: invoice.amount,
      amountPaid: invoice.amountPaid,
      dueAt: invoice.dueAt,
    });
    overdueByCustomer.set(invoice.customerId, rows);
  }

  for (const [customerId, rows] of overdueByCustomer) {
    const sorted = [...rows].sort(
      (left, right) => (left.dueAt?.getTime() ?? 0) - (right.dueAt?.getTime() ?? 0),
    );
    const balance = rows.reduce((total, row) => total + row.amount - row.amountPaid, 0);
    if (balance <= 0) continue;
    const oldest = sorted[0];
    const customer = oldest?.customer;
    if (!customer) continue;
    const oldestDue = oldest?.dueAt ?? now;
    const daysPastDue = daysBetween(now, oldestDue);
    const severity: RecommendationSeverity =
      balance > 50_000 || daysPastDue > 30 ? "HIGH" : "MEDIUM";
    const invoiceNumbers = sorted
      .slice(0, 3)
      .map((row) => row.number)
      .join(", ");
    const severityReasons: string[] = [];
    if (balance > 50_000) severityReasons.push(`the balance exceeds ${money(50_000)}`);
    if (daysPastDue > 30) severityReasons.push("it is more than 30 days past due");
    if (severityReasons.length === 0) {
      severityReasons.push(
        `the balance is under ${money(50_000)} and less than 30 days past due`,
      );
    }
    recommendations.push({
      id: `collections:${customerId}`,
      kind: "COLLECTIONS",
      severity,
      title: `${money(balance)} overdue from ${customer.name}`,
      detail: `${plural(sorted.length, "open invoice")} past due (${invoiceNumbers}${
        sorted.length > 3 ? ", …" : ""
      }); oldest due ${plural(daysPastDue, "day")} ago.`,
      rationale: `${money(balance)} in unpaid balance. Severity is ${
        severity === "HIGH" ? "high" : "medium"
      } because ${severityReasons.join(" and ")}.`,
      value: balance,
      customer,
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: `/app/invoices?invoice=${encodeURIComponent(oldest?.id ?? "")}`,
      createdAt,
    });
  }

  /* ------------------------------------------------------------- customer map */
  const customerMap = new Map<string, CustomerRollup>();
  for (const job of completedJobs) {
    if (!job.completedAt) continue;
    const existing = customerMap.get(job.customerId);
    const rollup: CustomerRollup = existing ?? {
      customer: toCustomerSummary(job.customer),
      completedCount: 0,
      revenueLastYear: 0,
      lastCompletedAt: job.completedAt,
      lastServiceAt: job.completedAt,
    };
    rollup.completedCount += 1;
    rollup.revenueLastYear += job.total;
    if (job.completedAt > rollup.lastCompletedAt) rollup.lastCompletedAt = job.completedAt;
    if (!rollup.lastServiceAt || job.completedAt > rollup.lastServiceAt) {
      rollup.lastServiceAt = job.completedAt;
    }
    customerMap.set(job.customerId, rollup);
  }

  const purchasedByCustomer = new Map<string, Set<string>>();
  for (const line of purchasedLineItems) {
    if (!line.serviceId) continue;
    const purchased = purchasedByCustomer.get(line.job.customerId) ?? new Set<string>();
    purchased.add(line.serviceId);
    purchasedByCustomer.set(line.job.customerId, purchased);
  }

  const lifetimeMap = new Map<string, number>(
    lifetimeCounts.map((row) => [row.customerId, row._count._all] as const),
  );
  const upcomingCustomerIds = new Set(openCustomerRows.map((row) => row.customerId));

  const openBalanceByCustomer = new Map<string, number>();
  for (const invoice of openInvoices) {
    const balance = invoice.amount - invoice.amountPaid;
    if (balance <= 0) continue;
    openBalanceByCustomer.set(
      invoice.customerId,
      (openBalanceByCustomer.get(invoice.customerId) ?? 0) + balance,
    );
  }

  /* --------------------------------------------------------------- churn risk */
  for (const [customerId, rollup] of customerMap) {
    const daysSinceLastJob = daysBetween(now, rollup.lastCompletedAt);
    if (daysSinceLastJob < 90) continue;
    const hasUpcoming = upcomingCustomerIds.has(customerId);
    if (hasUpcoming) continue;
    const openBalance = openBalanceByCustomer.get(customerId) ?? 0;
    const score = churnRiskScore({
      daysSinceLastJob,
      completedJobsLastYear: rollup.completedCount,
      hasUpcoming,
      openBalance,
    });
    if (score <= 0) continue;
    recommendations.push({
      id: `churn:${customerId}`,
      kind: "CHURN_RISK",
      severity: severityForScore(score),
      title: `${rollup.customer.name} may be drifting away`,
      detail: `Last completed job was ${plural(daysSinceLastJob, "day")} ago with no future job booked.`,
      rationale: `Churn risk ${score}/100: ${plural(
        rollup.completedCount,
        "completed job",
      )} in the last 12 months, ${daysSinceLastJob} days since the last visit${
        openBalance > 0 ? `, and ${money(openBalance)} still open` : ""
      }; ${money(rollup.revenueLastYear)} of revenue is exposed if they lapse.`,
      value: rollup.revenueLastYear > 0 ? rollup.revenueLastYear : null,
      customer: rollup.customer,
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: `/app/companies/${encodeURIComponent(customerId)}`,
      createdAt,
    });
  }

  /* ------------------------------------------------------------ no-show risk */
  const priorOutcomeMap = new Map<string, { noShows: number; cancellations: number }>();
  for (const row of priorOutcomes) {
    const entry = priorOutcomeMap.get(row.customerId) ?? { noShows: 0, cancellations: 0 };
    if (row.status === "NO_SHOW") entry.noShows += row._count._all;
    if (row.status === "CANCELED") entry.cancellations += row._count._all;
    priorOutcomeMap.set(row.customerId, entry);
  }
  const confirmedJobIds = new Set(
    recentCommunications
      .map((row) => row.jobId)
      .filter((jobId): jobId is string => Boolean(jobId)),
  );

  for (const job of upcomingJobs) {
    const prior = priorOutcomeMap.get(job.customerId);
    if (!prior || (prior.noShows === 0 && prior.cancellations === 0)) continue;
    if (!job.scheduledStart) continue;
    const leadTimeHours = Math.max(
      0,
      Math.round((job.scheduledStart.getTime() - now.getTime()) / 3_600_000),
    );
    const hasConfirmation = confirmedJobIds.has(job.id);
    const score = noShowRiskScore({
      priorNoShows: prior.noShows,
      priorCancellations: prior.cancellations,
      leadTimeHours,
      hasConfirmation,
    });
    if (score <= 0) continue;
    recommendations.push({
      id: `no-show:${job.id}`,
      kind: "NO_SHOW_RISK",
      severity: severityForScore(score),
      title: `${job.number} is at risk of a no-show`,
      detail: `${job.customer.name} has ${plural(prior.noShows, "prior no-show")} and ${
        prior.cancellations
      } cancellation${prior.cancellations === 1 ? "" : "s"}; the visit is ${plural(
        leadTimeHours,
        "hour",
      )} away.`,
      rationale: `No-show risk ${score}/100: ${prior.noShows} no-shows and ${
        prior.cancellations
      } cancellations on record, ${leadTimeHours}h lead time, ${
        hasConfirmation ? "a reminder or confirmation is logged" : "no confirmation message is logged"
      }.`,
      value: job.total,
      customer: toCustomerSummary(job.customer),
      jobId: job.id,
      jobNumber: job.number,
      serviceId: null,
      serviceName: null,
      href: `/app/schedule?job=${encodeURIComponent(job.id)}`,
      createdAt,
    });
  }

  /* ------------------------------------------------------------------ upsell */
  const upsellCandidates: UpsellOpportunity[] = [];
  for (const [customerId, rollup] of customerMap) {
    const lifetimeJobs = lifetimeMap.get(customerId) ?? rollup.completedCount;
    const daysSinceService = rollup.lastServiceAt
      ? daysBetween(now, rollup.lastServiceAt)
      : null;
    const purchasedServiceIds = purchasedByCustomer.get(customerId) ?? new Set<string>();
    for (const service of activeServices) {
      if (purchasedServiceIds.has(service.id)) continue;
      const marginPct =
        service.price > 0
          ? Math.round(((service.price - service.cost) / service.price) * 100)
          : null;
      const score = upsellScore({
        daysSinceService,
        price: service.price,
        marginPct,
        alreadyPurchased: false,
        customerLifetimeJobs: lifetimeJobs,
      });
      if (score <= 0) continue;
      const reason = `${plural(lifetimeJobs, "lifetime job")}, last service ${
        daysSinceService === null ? "not yet completed" : `${daysSinceService}d ago`
      }; ${service.name} has not been purchased.`;
      upsellCandidates.push({
        customer: rollup.customer,
        serviceId: service.id,
        serviceName: service.name,
        price: service.price,
        reason,
        score,
      });
    }
  }
  upsellCandidates.sort(
    (left, right) => right.score - left.score || right.price - left.price,
  );
  const upsells = upsellCandidates.slice(0, 5);

  for (const candidate of upsellCandidates.filter((row) => row.score >= 70).slice(0, 10)) {
    recommendations.push({
      id: `upsell:${candidate.customer.id}:${candidate.serviceId}`,
      kind: "UPSELL",
      severity: candidate.score >= 85 ? "HIGH" : "MEDIUM",
      title: `Offer ${candidate.serviceName} to ${candidate.customer.name}`,
      detail: candidate.reason,
      rationale: `Upsell fit ${candidate.score}/100 at ${money(
        candidate.price,
      )}; the service is active in the price book and this customer has not purchased it.`,
      value: candidate.price,
      customer: candidate.customer,
      jobId: null,
      jobNumber: null,
      serviceId: candidate.serviceId,
      serviceName: candidate.serviceName,
      href: `/app/companies/${encodeURIComponent(candidate.customer.id)}`,
      createdAt,
    });
  }

  /* -------------------------------------------------------- review requests */
  const reviewedJobIds = new Set(
    reviewCommunications
      .map((row) => row.jobId)
      .filter((jobId): jobId is string => Boolean(jobId)),
  );
  for (const job of recentCompleted) {
    if (reviewedJobIds.has(job.id) || !job.completedAt) continue;
    const daysAgo = daysBetween(now, job.completedAt);
    recommendations.push({
      id: `review:${job.id}`,
      kind: "REVIEW_REQUEST",
      severity: "MEDIUM",
      title: `Ask ${job.customer.name} for a review`,
      detail: `${job.number} completed ${plural(daysAgo, "day")} ago and no review request is logged.`,
      rationale: `Completed ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago with no REVIEW communication on the job; the feedback window is still open.`,
      value: job.total,
      customer: toCustomerSummary(job.customer),
      jobId: job.id,
      jobNumber: job.number,
      serviceId: null,
      serviceName: null,
      href: `/app/schedule?job=${encodeURIComponent(job.id)}`,
      createdAt,
    });
  }

  /* --------------------------------------------------------------- staffing */
  if (unassignedToday > 0) {
    const scheduledValue = unassignedAggregate._sum.total ?? 0;
    recommendations.push({
      id: `staffing:${dayKey(startOfToday)}`,
      kind: "STAFFING",
      severity: unassignedToday >= 3 ? "HIGH" : "MEDIUM",
      title: `${plural(unassignedToday, "job")} unassigned today`,
      detail: `${unassignedTodayJobs
        .slice(0, 5)
        .map((job) => job.number)
        .join(", ")}${
        unassignedToday > 5 ? ", …" : ""
      } still need a technician.`,
      rationale: `${unassignedToday} open job${
        unassignedToday === 1 ? "" : "s"
      } scheduled today have no assignee, representing ${money(scheduledValue)} of scheduled work.`,
      value: scheduledValue,
      customer: null,
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: "/app/schedule?scope=today",
      createdAt,
    });
  }

  /* ----------------------------------------------------------- quote follow-up */
  for (const estimate of staleEstimates) {
    const anchor = estimate.issuedAt ?? estimate.createdAt;
    const daysWaiting = daysBetween(now, anchor);
    recommendations.push({
      id: `quote:${estimate.id}`,
      kind: "QUOTE_FOLLOW_UP",
      severity: daysWaiting >= 14 ? "HIGH" : "MEDIUM",
      title: `Follow up on ${estimate.number} for ${estimate.customer.name}`,
      detail: `${money(estimate.total)} quote ${
        estimate.issuedAt ? "sent" : "created"
      } ${plural(daysWaiting, "day")} ago and still awaiting a decision.`,
      rationale: `Status is SENT and it has been ${daysWaiting} days since ${
        estimate.issuedAt ? "it was issued" : "it was created"
      }; ${daysWaiting >= 14 ? "more than two weeks is a high-risk silence" : "more than one week without a reply"}.`,
      value: estimate.total,
      customer: toCustomerSummary(estimate.customer),
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: `/app/estimates?estimate=${encodeURIComponent(estimate.id)}`,
      createdAt,
    });
  }

  /* ---------------------------------------------------------------- forecast */
  const scheduledRevenue = scheduledAggregate._sum.total ?? 0;
  const scheduledCount = scheduledAggregate._count._all;
  const pipelineWeighted = openDeals.reduce((total, deal) => {
    const probability = Math.min(100, Math.max(0, deal.stage.probability));
    return total + Math.round((deal.value * probability) / 100);
  }, 0);
  const recurringTotal = recurringAggregate._sum.total ?? 0;
  const recurringCount = recurringAggregate._count._all;
  const recurringRunRate = Math.round(recurringTotal / 3);
  const dataPoints = scheduledCount + openDeals.length + recurringCount;
  const confidence: RevenueForecast["confidence"] =
    dataPoints >= 12 ? "high" : dataPoints >= 4 ? "medium" : "low";
  const next30Days = scheduledRevenue + pipelineWeighted + recurringRunRate;

  const forecast: RevenueForecast = {
    next30Days,
    scheduled: scheduledRevenue,
    pipelineWeighted,
    recurring: recurringRunRate,
    confidence,
    assumptions: [
      `${plural(scheduledCount, "remaining scheduled job")} this month ${agreement(
        scheduledCount,
        "contributes",
        "contribute",
      )} ${money(scheduledRevenue)} of booked job totals.`,
      `${plural(openDeals.length, "open deal")} ${agreement(
        openDeals.length,
        "is",
        "are",
      )} weighted by current stage probability for ${money(pipelineWeighted)}.`,
      `${plural(recurringCount, "recurring job")} completed in the last 90 days ${agreement(
        recurringCount,
        "runs",
        "run",
      )} at ${money(recurringRunRate)} per month.`,
      `Confidence is ${confidence} based on ${dataPoints} scheduled, pipeline and recurring data points.`,
    ],
  };

  const hasForecastData =
    scheduledCount > 0 || openDeals.length > 0 || recurringCount > 0;
  if (hasForecastData) {
    recommendations.push({
      id: `forecast:${now.toISOString().slice(0, 7)}`,
      kind: "REVENUE_FORECAST",
      severity: "INFO",
      title: `${money(next30Days)} projected in the next 30 days`,
      detail: `${money(scheduledRevenue)} scheduled + ${money(
        pipelineWeighted,
      )} weighted pipeline + ${money(recurringRunRate)} recurring.`,
      rationale: forecast.assumptions.join(" "),
      value: next30Days,
      customer: null,
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: "/app/deals",
      createdAt,
    });
  }

  /* ------------------------------------------------------------------ routes */
  const stopsByDay = new Map<string, number>();
  for (const job of upcomingJobs) {
    if (!job.scheduledStart) continue;
    if (job.scheduledStart < startOfToday || job.scheduledStart >= weekAhead) continue;
    const key = dayKey(job.scheduledStart);
    stopsByDay.set(key, (stopsByDay.get(key) ?? 0) + 1);
  }
  for (const [day, stops] of stopsByDay) {
    if (stops <= 6) continue;
    recommendations.push({
      id: `route:${day}`,
      kind: "ROUTE",
      severity: "INFO",
      title: `${stops} stops scheduled on ${day}`,
      detail: `${stops} open jobs share the day; no persisted route order exists, so dispatch ordering is still open.`,
      rationale: `High-density day with ${stops} stops (>6); batching or route optimization can cut drive time.`,
      value: null,
      customer: null,
      jobId: null,
      jobNumber: null,
      serviceId: null,
      serviceName: null,
      href: "/app/schedule?scope=week",
      createdAt,
    });
  }

  const sorted = capByKind(recommendations);
  const counts = Object.fromEntries(
    RECOMMENDATION_KINDS.map(
      (kind) => [kind, sorted.filter((row) => row.kind === kind).length] as const,
    ),
  ) as Record<RecommendationKind, number>;

  const overdueAmount = Math.max(
    0,
    (overdueAggregate._sum.amount ?? 0) - (overdueAggregate._sum.amountPaid ?? 0),
  );

  const health: IntelligenceHealth = {
    churnRiskCustomers: recommendations.filter((row) => row.kind === "CHURN_RISK").length,
    noShowRiskJobs: recommendations.filter((row) => row.kind === "NO_SHOW_RISK").length,
    overdueAmount,
    unassignedToday,
    unbilledJobs,
    staleQuotes: staleEstimateCount,
  };

  return {
    generatedAt: createdAt,
    recommendations: sorted,
    counts,
    forecast,
    health,
    upsells,
  };
}

export function buildAssistantBrief(
  summary: IntelligenceSummary,
  currency = "USD",
): AssistantBrief {
  const money = (cents: number) => formatMoney(cents, currency);
  const high = summary.recommendations.filter((row) => row.severity === "HIGH");

  const headline =
    high.length > 0
      ? `${plural(high.length, "high-priority item")} need${high.length === 1 ? "s" : ""} attention`
      : summary.recommendations.length > 0
        ? "The board is steady, with a few items to review"
        : "Operations are clear today";

  const summaryLine =
    summary.recommendations.length === 0
      ? "No collections, retention, dispatch or quote issues were detected from the current data."
      : `${plural(summary.recommendations.length, "recommendation")} generated, ${
          high.length
        } high severity. ${money(summary.forecast.next30Days)} is projected over the next 30 days.`;

  const bullets = [
    high.length > 0
      ? `${plural(high.length, "high-severity recommendation")} need attention first.`
      : "No high-severity risks are open right now.",
    summary.health.overdueAmount > 0
      ? `${money(summary.health.overdueAmount)} is overdue and needs collection follow-up.`
      : "No overdue invoice balances are outstanding.",
    summary.health.unassignedToday > 0
      ? `${plural(summary.health.unassignedToday, "job")} scheduled today have no assignee.`
      : "Every job scheduled today has an assignee.",
    `Forecast: ${money(summary.forecast.next30Days)} next 30 days (${summary.forecast.confidence} confidence).`,
    `${plural(summary.health.staleQuotes, "quote")} sent 7+ days ago and ${plural(
      summary.health.unbilledJobs,
      "completed job",
    )} still unbilled.`,
  ];

  return {
    headline,
    summary: summaryLine,
    bullets,
    focus: summary.recommendations.slice(0, 3),
  };
}
