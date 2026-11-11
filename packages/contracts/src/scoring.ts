/**
 * Deterministic, explainable scores. Each returns 0-100 plus the factors the
 * API exposes in recommendation rationales. No opaque model weights.
 */

export interface ChurnSignals {
  daysSinceLastJob: number | null;
  completedJobsLastYear: number;
  hasUpcoming: boolean;
  openBalance: number;
}

export function churnRiskScore(signals: ChurnSignals): number {
  if (signals.hasUpcoming) return 0;
  if (signals.daysSinceLastJob === null || signals.completedJobsLastYear === 0) return 0;
  let score = Math.min(70, Math.round((signals.daysSinceLastJob / 180) * 70));
  if (signals.completedJobsLastYear >= 4) score += 15;
  else if (signals.completedJobsLastYear >= 2) score += 8;
  if (signals.openBalance > 0) score += 5;
  return Math.min(100, score);
}

export interface NoShowSignals {
  priorNoShows: number;
  priorCancellations: number;
  leadTimeHours: number;
  hasConfirmation: boolean;
}

export function noShowRiskScore(signals: NoShowSignals): number {
  let score = 0;
  score += Math.min(45, signals.priorNoShows * 22);
  score += Math.min(25, signals.priorCancellations * 8);
  if (signals.leadTimeHours > 168) score += 15;
  else if (signals.leadTimeHours > 72) score += 8;
  if (!signals.hasConfirmation) score += 10;
  return Math.min(100, score);
}

export interface UpsellSignals {
  daysSinceService: number | null;
  price: number;
  marginPct: number | null;
  alreadyPurchased: boolean;
  customerLifetimeJobs: number;
}

export function upsellScore(signals: UpsellSignals): number {
  if (signals.alreadyPurchased) return 0;
  let score = 35;
  if (signals.customerLifetimeJobs >= 3) score += 20;
  else if (signals.customerLifetimeJobs >= 1) score += 10;
  if (signals.daysSinceService === null) score += 5;
  else if (signals.daysSinceService >= 30) score += 15;
  else if (signals.daysSinceService >= 7) score += 8;
  if (signals.marginPct !== null && signals.marginPct >= 40) score += 10;
  if (signals.price > 0) score += 5;
  return Math.min(100, score);
}
