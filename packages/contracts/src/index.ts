export * from "./enums.js";
export * from "./common.js";
export * from "./entities.js";
export * from "./service.js";
export * from "./auth.js";
export * from "./insights.js";
export * from "./momentum.js";
export * from "./communications.js";
export * from "./finance.js";
export * from "./dispatch.js";
export * from "./automation.js";
export * from "./intelligence.js";
export * from "./team.js";
export * from "./timeline.js";
export * from "./invoice-rules.js";
export * from "./route.js";
export * from "./drafts.js";
export * from "./scoring.js";
export * from "./website.js";

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  uptime: number;
  database: "up" | "down";
}
