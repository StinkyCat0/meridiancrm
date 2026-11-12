import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Every cache key in the app flows through this factory. */
export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
    invite: (token: string) => ["auth", "invite", token] as const,
  },
  workspace: {
    detail: ["workspace"] as const,
    members: ["workspace", "members"] as const,
    invites: ["workspace", "invites"] as const,
    audit: (query?: unknown) => ["workspace", "audit", query ?? null] as const,
  },
  companies: {
    all: ["companies"] as const,
    list: (query?: unknown) => ["companies", "list", query ?? null] as const,
    detail: (id: string) => ["companies", "detail", id] as const,
    timeline: (id: string) => ["companies", "timeline", id] as const,
  },
  contacts: {
    all: ["contacts"] as const,
    list: (query?: unknown) => ["contacts", "list", query ?? null] as const,
    detail: (id: string) => ["contacts", "detail", id] as const,
  },
  deals: {
    all: ["deals"] as const,
    list: (query?: unknown) => ["deals", "list", query ?? null] as const,
    detail: (id: string) => ["deals", "detail", id] as const,
    history: (id: string) => ["deals", "history", id] as const,
  },
  pipelines: {
    all: ["pipelines"] as const,
  },
  activities: {
    all: ["activities"] as const,
    list: (query?: unknown) => ["activities", "list", query ?? null] as const,
  },
  locations: {
    all: ["locations"] as const,
    list: (query?: unknown) => ["locations", "list", query ?? null] as const,
    detail: (id: string) => ["locations", "detail", id] as const,
  },
  services: {
    all: ["services"] as const,
    list: (query?: unknown) => ["services", "list", query ?? null] as const,
    detail: (id: string) => ["services", "detail", id] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    list: (query?: unknown) => ["jobs", "list", query ?? null] as const,
    detail: (id: string) => ["jobs", "detail", id] as const,
  },
  estimates: {
    all: ["estimates"] as const,
    list: (query?: unknown) => ["estimates", "list", query ?? null] as const,
    detail: (id: string) => ["estimates", "detail", id] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    list: (query?: unknown) => ["invoices", "list", query ?? null] as const,
    detail: (id: string) => ["invoices", "detail", id] as const,
  },
  ops: {
    summary: (date?: string) => ["ops", "summary", date ?? "today"] as const,
  },
  insights: {
    dashboard: (months?: number) =>
      ["insights", "dashboard", months ?? null] as const,
    search: (q: string) => ["insights", "search", q] as const,
  },
  communications: {
    all: ["communications"] as const,
    list: (query?: unknown) =>
      ["communications", "list", query ?? null] as const,
    threads: (query?: unknown) =>
      ["communications", "threads", query ?? null] as const,
    stats: ["communications", "stats"] as const,
    detail: (id: string) => ["communications", "detail", id] as const,
  },
  dispatch: {
    all: ["dispatch"] as const,
    board: (query?: unknown) => ["dispatch", "board", query ?? null] as const,
    map: (query?: unknown) => ["dispatch", "map", query ?? null] as const,
    route: (query?: unknown) => ["dispatch", "route", query ?? null] as const,
  },
  finance: {
    all: ["finance"] as const,
    summary: (query?: unknown) =>
      ["finance", "summary", query ?? null] as const,
    payments: (query?: unknown) =>
      ["finance", "payments", query ?? null] as const,
    expenses: (query?: unknown) =>
      ["finance", "expenses", query ?? null] as const,
  },
  automations: {
    all: ["automations"] as const,
    list: (query?: unknown) => ["automations", "list", query ?? null] as const,
    detail: (id: string) => ["automations", "detail", id] as const,
    runs: (query?: unknown) => ["automations", "runs", query ?? null] as const,
  },
  intelligence: {
    all: ["intelligence"] as const,
    summary: ["intelligence", "summary"] as const,
    recommendations: (query?: unknown) =>
      ["intelligence", "recommendations", query ?? null] as const,
    brief: ["intelligence", "brief"] as const,
  },
  team: {
    all: ["team"] as const,
    performance: (query?: unknown) =>
      ["team", "performance", query ?? null] as const,
    workload: (date?: string) => ["team", "workload", date ?? "today"] as const,
  },
};
