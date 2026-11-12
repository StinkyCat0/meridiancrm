import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  api,
  type CreateActivityInput,
  type CreateDealInput,
  type DealStatusFilter,
  type UpdateDealInput,
} from "@meridian/api-client";
import type {
  Activity,
  Company,
  Contact,
  Deal,
  Member,
  Momentum,
  Page,
  Pipeline,
  Stage,
  StageHistoryEntry,
} from "@meridian/contracts";
import { toast } from "sonner";
import { queryKeys } from "../../lib/query";
import { errorMessage } from "./lib/deals";

/** Prefix shared by every deal list query, used for optimistic patching/rollback. */
const DEALS_LIST_PREFIX = ["deals", "list"] as const;
const DASHBOARD_PREFIX = ["insights", "dashboard"] as const;
const FORM_LOOKUP_LIMIT = 100;

export interface DealsListParams {
  pipelineId?: string;
  status: DealStatusFilter;
  q?: string;
  ownerId?: string;
  stageId?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export function usePipelines() {
  return useQuery<Pipeline[]>({
    queryKey: queryKeys.pipelines.all,
    queryFn: () => api.pipelines.list(),
    staleTime: 5 * 60_000,
  });
}

export function useWorkspaceMembers() {
  return useQuery<Member[]>({
    queryKey: queryKeys.workspace.members,
    queryFn: () => api.workspace.members(),
  });
}

export function useDealsList(params: DealsListParams) {
  return useQuery<Page<Deal>>({
    queryKey: queryKeys.deals.list(params),
    queryFn: () => api.deals.list({ pageSize: 100, ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useDealDetail(dealId: string | null) {
  return useQuery<Deal>({
    queryKey: queryKeys.deals.detail(dealId ?? ""),
    queryFn: () => {
      if (!dealId) throw new Error("A deal id is required");
      return api.deals.get(dealId);
    },
    enabled: Boolean(dealId),
  });
}

export function useDealHistory(dealId: string | null) {
  return useQuery<StageHistoryEntry[]>({
    queryKey: queryKeys.deals.history(dealId ?? ""),
    queryFn: () => {
      if (!dealId) throw new Error("A deal id is required");
      return api.deals.history(dealId);
    },
    enabled: Boolean(dealId),
  });
}

export function useDealActivities(dealId: string | null) {
  const query = { dealId: dealId ?? undefined, pageSize: 50 };
  return useQuery<Page<Activity>>({
    queryKey: queryKeys.activities.list(query),
    queryFn: () => api.activities.list(query),
    enabled: Boolean(dealId),
  });
}

/** Company/contact options are only fetched while the deal form is open. */
export function useDealLookups(enabled: boolean) {
  const companies = useQuery<Page<Company>>({
    queryKey: queryKeys.companies.list({
      pageSize: FORM_LOOKUP_LIMIT,
      archive: "active",
    }),
    queryFn: () =>
      api.companies.list({ pageSize: FORM_LOOKUP_LIMIT, archive: "active" }),
    enabled,
    staleTime: 60_000,
  });

  const contacts = useQuery<Page<Contact>>({
    queryKey: queryKeys.contacts.list({
      pageSize: FORM_LOOKUP_LIMIT,
      archive: "active",
      scope: "deal-form",
    }),
    queryFn: () =>
      api.contacts.list({ pageSize: FORM_LOOKUP_LIMIT, archive: "active" }),
    enabled,
    staleTime: 60_000,
  });

  return { companies, contacts };
}

function invalidateDealCaches(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.deals.all });
  void client.invalidateQueries({ queryKey: DASHBOARD_PREFIX });
  void client.invalidateQueries({ queryKey: queryKeys.companies.all });
  void client.invalidateQueries({ queryKey: queryKeys.contacts.all });
}

function invalidateActivityCaches(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.activities.all });
  invalidateDealCaches(client);
}

function optimisticMomentum(deal: Deal, stage: Stage): Momentum {
  if (stage.kind === "WON") return { score: 100, band: "hot", breakdown: [] };
  if (stage.kind === "LOST") return { score: 0, band: "cold", breakdown: [] };
  return deal.momentum;
}

function withStage(deal: Deal, stage: Stage): Deal {
  const now = new Date().toISOString();
  return {
    ...deal,
    stageId: stage.id,
    stage,
    pipelineId: stage.pipelineId,
    probability: stage.probability,
    stageChangedAt: now,
    closedAt: stage.kind === "OPEN" ? null : (deal.closedAt ?? now),
    momentum: optimisticMomentum(deal, stage),
  };
}

export function useCreateDeal() {
  const client = useQueryClient();
  return useMutation<Deal, unknown, CreateDealInput>({
    mutationFn: (input) => api.deals.create(input),
    onSuccess: (deal) => {
      client.setQueryData(queryKeys.deals.detail(deal.id), deal);
      toast.success("Deal created");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidateDealCaches(client),
  });
}

export function useUpdateDeal() {
  const client = useQueryClient();
  return useMutation<Deal, unknown, { id: string; input: UpdateDealInput }>({
    mutationFn: ({ id, input }) => api.deals.update(id, input),
    onSuccess: (deal) => {
      client.setQueryData(queryKeys.deals.detail(deal.id), deal);
      toast.success("Deal updated");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidateDealCaches(client),
  });
}

export function useDeleteDeal() {
  const client = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => api.deals.delete(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: queryKeys.deals.detail(id) });
      client.removeQueries({ queryKey: queryKeys.deals.history(id) });
      toast.success("Deal deleted");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidateDealCaches(client),
  });
}

interface MoveStageVariables {
  deal: Deal;
  stage: Stage;
}

interface MoveStageContext {
  lists: Array<[QueryKey, Page<Deal> | undefined]>;
  detail: Deal | undefined;
}

export function useMoveDealStage() {
  const client = useQueryClient();

  return useMutation<Deal, unknown, MoveStageVariables, MoveStageContext>({
    mutationFn: ({ deal, stage }) => api.deals.moveStage(deal.id, stage.id),
    onMutate: async ({ deal, stage }) => {
      await client.cancelQueries({ queryKey: DEALS_LIST_PREFIX });
      await client.cancelQueries({ queryKey: queryKeys.deals.detail(deal.id) });

      const lists = client.getQueriesData<Page<Deal>>({
        queryKey: DEALS_LIST_PREFIX,
      });
      const detail = client.getQueryData<Deal>(queryKeys.deals.detail(deal.id));

      client.setQueriesData<Page<Deal>>(
        { queryKey: DEALS_LIST_PREFIX },
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((row) =>
                  row.id === deal.id ? withStage(row, stage) : row,
                ),
              }
            : page,
      );
      client.setQueryData<Deal>(queryKeys.deals.detail(deal.id), (current) =>
        current ? withStage(current, stage) : current,
      );

      return { lists, detail };
    },
    onError: (error, { deal }, context) => {
      if (context) {
        for (const [key, data] of context.lists) {
          if (data) client.setQueryData(key, data);
        }
        if (context.detail) {
          client.setQueryData(queryKeys.deals.detail(deal.id), context.detail);
        }
      }
      toast.error(errorMessage(error));
    },
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.deals.detail(updated.id), updated);
      toast.success(`Deal moved to ${updated.stage.name}`);
    },
    onSettled: () => invalidateDealCaches(client),
  });
}

export function useCreateDealActivity() {
  const client = useQueryClient();
  return useMutation<Activity, unknown, CreateActivityInput>({
    mutationFn: (input) => api.activities.create(input),
    onSuccess: () => toast.success("Activity logged"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidateActivityCaches(client),
  });
}

interface ToggleActivityVariables {
  activity: Activity;
  completed: boolean;
}

export function useToggleActivity() {
  const client = useQueryClient();
  return useMutation<Activity, unknown, ToggleActivityVariables>({
    mutationFn: ({ activity, completed }) =>
      api.activities.update(activity.id, {
        completedAt: completed ? new Date().toISOString() : null,
      }),
    onSuccess: (_activity, { completed }) =>
      toast.success(completed ? "Task completed" : "Task reopened"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => invalidateActivityCaches(client),
  });
}
