import { z } from "zod";
import {
  RECOMMENDATION_KINDS,
  RECOMMENDATION_SEVERITIES,
  type RecommendationKind,
  type RecommendationSeverity,
} from "./enums.js";
import type { CustomerSummary } from "./service.js";

export interface UpsellOpportunity {
  customer: CustomerSummary;
  serviceId: string;
  serviceName: string;
  price: number;
  reason: string;
  score: number;
}

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  rationale: string;
  value: number | null;
  customer: CustomerSummary | null;
  jobId: string | null;
  jobNumber: string | null;
  serviceId: string | null;
  serviceName: string | null;
  href: string;
  createdAt: string;
}

export interface RevenueForecast {
  next30Days: number;
  scheduled: number;
  pipelineWeighted: number;
  recurring: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
}

export interface IntelligenceHealth {
  churnRiskCustomers: number;
  noShowRiskJobs: number;
  overdueAmount: number;
  unassignedToday: number;
  unbilledJobs: number;
  staleQuotes: number;
}

export interface IntelligenceSummary {
  generatedAt: string;
  recommendations: Recommendation[];
  counts: Record<RecommendationKind, number>;
  forecast: RevenueForecast;
  health: IntelligenceHealth;
  upsells: UpsellOpportunity[];
}

export interface AssistantBrief {
  headline: string;
  summary: string;
  bullets: string[];
  focus: Recommendation[];
}

export const intelligenceQuerySchema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type IntelligenceQuery = z.infer<typeof intelligenceQuerySchema>;
