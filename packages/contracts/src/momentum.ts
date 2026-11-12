import type { Momentum, MomentumBreakdown, StageKind } from "./index.js";

export interface MomentumInput {
  stageKind: StageKind;
  stageAgeDays: number;
  stageTargetDays: number;
  /** Number of activities linked directly to the deal in the last 30 days. */
  activityCount30d: number;
  /** Days since the most recent linked activity; null when there has never been one. */
  lastActivityDaysAgo: number | null;
  expectedCloseDate: Date | null;
  now?: Date;
}

/**
 * Deterministic deal momentum, 0–100. Deliberately simple and explainable:
 * recency 40, engagement 20, stage health 25, close-date pressure 15.
 * Closed deals short-circuit to 100 (won) or 0 (lost).
 * This function is shared by the API and any client so the number never disagrees.
 */
export function computeMomentum(input: MomentumInput): Momentum {
  if (input.stageKind === "WON") return closedMomentum(100);
  if (input.stageKind === "LOST") return closedMomentum(0);

  const recency = scoreRecency(input.lastActivityDaysAgo);
  const engagement = scoreEngagement(input.activityCount30d);
  const stage = scoreStage(input.stageAgeDays, input.stageTargetDays);
  const closeDate = scoreCloseDate(
    input.expectedCloseDate,
    input.now ?? new Date(),
  );

  const breakdown: MomentumBreakdown[] = [
    {
      key: "recency",
      label: "Last touch",
      points: recency,
      max: 40,
      detail:
        input.lastActivityDaysAgo === null
          ? "No activity logged yet"
          : `${input.lastActivityDaysAgo}d since last activity`,
    },
    {
      key: "engagement",
      label: "Engagement",
      points: engagement,
      max: 20,
      detail: `${input.activityCount30d} activit${input.activityCount30d === 1 ? "y" : "ies"} in 30 days`,
    },
    {
      key: "stage",
      label: "Stage velocity",
      points: stage,
      max: 25,
      detail: `${input.stageAgeDays}d in stage (target ${input.stageTargetDays}d)`,
    },
    {
      key: "closeDate",
      label: "Close plan",
      points: closeDate,
      max: 15,
      detail: closeDateDetail(input.expectedCloseDate, input.now ?? new Date()),
    },
  ];

  const score = recency + engagement + stage + closeDate;
  return {
    score,
    band: score >= 70 ? "hot" : score >= 40 ? "warm" : "cold",
    breakdown,
  };
}

function scoreRecency(days: number | null): number {
  if (days === null) return 0;
  if (days <= 2) return 40;
  if (days <= 7) return 32;
  if (days <= 14) return 22;
  if (days <= 30) return 12;
  return 4;
}

function scoreEngagement(count: number): number {
  if (count >= 6) return 20;
  if (count >= 3) return 14;
  if (count >= 1) return 7;
  return 0;
}

function scoreStage(ageDays: number, targetDays: number): number {
  if (ageDays <= targetDays) return 25;
  if (ageDays <= targetDays * 2) return 15;
  return 5;
}

function scoreCloseDate(date: Date | null, now: Date): number {
  if (!date) return 7;
  const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return 0;
  if (days <= 7) return 15;
  if (days <= 30) return 10;
  return 6;
}

function closeDateDetail(date: Date | null, now: Date): string {
  if (!date) return "No expected close date";
  const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `Closes in ${days}d`;
}

function closedMomentum(score: number): Momentum {
  return { score, band: score === 100 ? "hot" : "cold", breakdown: [] };
}

export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toLocaleString()} ${currency}`;
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
