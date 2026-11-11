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
    dashboard: (months?: number) => ["insights", "dashboard", months ?? null] as const,
    search: (q: string) => ["insights", "search", q] as const,
  },
};
