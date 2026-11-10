import type { Activity, Deal } from "./entities.js";
import type { ActivityType, StageKind, TopLevelEntity } from "./enums.js";

export interface TrendPoint {
  month: string;
  won: number;
  created: number;
}

export interface StageBucket {
  stageId: string;
  stageName: string;
  kind: StageKind;
  count: number;
  value: number;
}

export interface DashboardSummary {
  pipelineValue: number;
  openDealCount: number;
  wonValueThisMonth: number;
  wonCountThisMonth: number;
  winRate: number;
  avgDealSize: number;
  revenueTrend: TrendPoint[];
  stageDistribution: StageBucket[];
  activityMix: { type: ActivityType; count: number }[];
  momentum: { hot: number; warm: number; cold: number };
  recentDeals: Deal[];
  tasksDue: Activity[];
  currency: string;
}

export interface SearchHit {
  id: string;
  type: TopLevelEntity;
  label: string;
  sublabel: string | null;
  href: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  query: string;
}
