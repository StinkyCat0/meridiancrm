import { z } from "zod";
import { idSchema } from "./common.js";
import type { PublicUser } from "./entities.js";
import type { Job } from "./service.js";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface DispatchTechnician {
  user: PublicUser;
  jobs: Job[];
  jobCount: number;
  scheduledMinutes: number;
  utilizationPct: number;
}

export interface DispatchStats {
  total: number;
  unassigned: number;
  inProgress: number;
  completed: number;
  noShow: number;
}

export interface DispatchBoard {
  date: string;
  technicians: DispatchTechnician[];
  unassigned: Job[];
  stats: DispatchStats;
  depot: GeoPoint | null;
}

export interface DispatchStop {
  jobId: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  customerName: string;
  address: string;
  latitude: number;
  longitude: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignee: PublicUser | null;
  routeOrder: number | null;
}

export interface DispatchMap {
  date: string;
  stops: DispatchStop[];
  missingLocationCount: number;
  depot: GeoPoint | null;
  center: GeoPoint | null;
}

export interface DispatchRoute {
  date: string;
  assignee: PublicUser;
  start: GeoPoint;
  stops: DispatchStop[];
  totalDistanceMeters: number;
  totalDurationMinutes: number;
  optimized: boolean;
}

export const dispatchDateSchema = z.object({
  date: z.string().trim().max(40).optional(),
  assigneeId: z.string().trim().max(64).optional(),
});

export const dispatchAssignSchema = z.object({
  jobIds: z.array(idSchema).min(1).max(50),
  assigneeId: z.preprocess(
    (value) => (value === "" ? null : value),
    idSchema.nullable(),
  ),
});

export type DispatchDateQuery = z.infer<typeof dispatchDateSchema>;
export type DispatchAssignInput = z.infer<typeof dispatchAssignSchema>;
