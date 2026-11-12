import { z } from "zod";
import type { Role } from "./enums.js";
import type { PublicUser } from "./entities.js";
import type { FinanceRange } from "./finance.js";

export interface TeamMemberPerformance {
  user: PublicUser;
  role: Role;
  jobsScheduled: number;
  jobsCompleted: number;
  jobsCanceled: number;
  jobsNoShow: number;
  revenue: number;
  margin: number;
  avgTicket: number;
  utilizationPct: number;
  ratingAvg: number | null;
  ratingCount: number;
  openJobs: number;
  upcomingMinutes: number;
}

export interface TeamTotals {
  jobsScheduled: number;
  jobsCompleted: number;
  revenue: number;
  margin: number;
  avgTicket: number;
  utilizationPct: number;
  ratingAvg: number | null;
}

export interface TeamPerformance {
  range: FinanceRange;
  currency: string;
  members: TeamMemberPerformance[];
  totals: TeamTotals;
}

export interface TeamWorkloadMember {
  user: PublicUser;
  jobCount: number;
  scheduledMinutes: number;
  capacityMinutes: number;
  utilizationPct: number;
  nextStart: string | null;
  jobsCompletedToday: number;
}

export interface TeamWorkload {
  date: string;
  members: TeamWorkloadMember[];
  unassigned: number;
  totalScheduledMinutes: number;
}

export const teamRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const teamWorkloadQuerySchema = z.object({
  date: z.string().trim().max(40).optional(),
});

export type TeamRangeQuery = z.infer<typeof teamRangeSchema>;
