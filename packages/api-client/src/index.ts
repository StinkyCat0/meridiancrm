import {
  type Activity,
  type ActivityType,
  type AssistantBrief,
  type AuditEntry,
  type AuthSession,
  type AutomationAction,
  type AutomationConditions,
  type AutomationRun,
  type AutomationRule,
  type AutomationRunStatus,
  type AutomationTrigger,
  type BusinessType,
  type Communication,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationDraft,
  type CommunicationIntent,
  type CommunicationSentiment,
  type CommunicationStats,
  type CommunicationStatus,
  type CommunicationThread,
  type Company,
  type Contact,
  type Currency,
  type CustomerTimeline,
  type CustomerType,
  type DashboardSummary,
  type Deal,
  type DispatchBoard,
  type DispatchMap,
  type DispatchRoute,
  type Estimate,
  type EstimateStatus,
  type Expense,
  type ExpenseCategory,
  type FinanceSummary,
  type Industry,
  type IntelligenceSummary,
  type Invite,
  type Invoice,
  type InvoiceStatus,
  type Job,
  type JobPriority,
  type JobStatus,
  type Location,
  type MeResponse,
  type Member,
  type OpsSummary,
  type Page,
  type Payment,
  type PaymentMethod,
  type Pipeline,
  type Recommendation,
  type RecommendationKind,
  type RecurrenceFrequency,
  type ServiceItem,
  type ServiceUnit,
  type PublicUser,
  type Role,
  type SearchResponse,
  type Stage,
  type StageHistoryEntry,
  type StageKind,
  type TeamPerformance,
  type TeamWorkload,
  type WorkspaceSummary,
} from "@meridian/contracts";

const BASE_URL = "/api/v1";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the request never reached the server (offline, DNS, aborted). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ErrorEnvelope | null = null;
  try {
    payload = (await response.json()) as ErrorEnvelope;
  } catch {
    payload = null;
  }
  const code = typeof payload?.error?.code === "string" ? payload.error.code : "HTTP_ERROR";
  const message =
    typeof payload?.error?.message === "string"
      ? payload.error.message
      : payload
        ? response.statusText || `Request failed with status ${response.status}`
        : `The API returned a non-JSON response (HTTP ${response.status}). Check that the API server is running.`;
  return new ApiError(response.status, code, message, payload?.error?.details);
}

/* -------------------------------------------------------------------------- */
/* Token state (memory only — the refresh token lives in an httpOnly cookie)   */
/* -------------------------------------------------------------------------- */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/* -------------------------------------------------------------------------- */
/* Session expiry                                                              */
/* -------------------------------------------------------------------------- */

export type SessionExpiredHandler = () => void;

const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

/**
 * Subscribes to session expiry: a refresh attempt failed while an access token
 * existed, so the session is gone and the token has been cleared. Returns an
 * unsubscribe function.
 */
export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => {
    sessionExpiredHandlers.delete(handler);
  };
}

function emitSessionExpired(): void {
  for (const handler of [...sessionExpiredHandlers]) {
    try {
      handler();
    } catch {
      // A failing subscriber must not stop the remaining subscribers.
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Request plumbing                                                            */
/* -------------------------------------------------------------------------- */

export type QueryValue = string | number | boolean | null | undefined;
export type ListQuery = Record<string, QueryValue>;

type QueryInput = URLSearchParams | object;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: QueryInput;
  signal?: AbortSignal;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  refreshed?: boolean;
}

function buildQuery(query?: QueryInput): string {
  if (!query) return "";
  if (query instanceof URLSearchParams) {
    const serialized = query.toString();
    return serialized ? `?${serialized}` : "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Endpoints that establish or rotate a session (plus the public invite
 * preview). A 401 from these is a credential failure, not an expired access
 * token, so they must never trigger an automatic refresh. Every other path —
 * including `/auth/me` and `/auth/password` — is protected and may refresh.
 */
const NO_REFRESH_PATHS: Record<string, true> = {
  "/auth/login": true,
  "/auth/register": true,
  "/auth/refresh": true,
  "/auth/logout": true,
  "/auth/accept-invite": true,
};

async function execute<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (!options.skipAuth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${buildQuery(options.query)}`, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Could not reach Meridian. Check your connection and try again.",
      cause,
    );
  }

  if (
    response.status === 401 &&
    !options.skipRefresh &&
    !options.refreshed &&
    !NO_REFRESH_PATHS[path] &&
    !path.startsWith("/auth/invite/")
  ) {
    try {
      await refreshSession();
    } catch {
      // refreshSession already cleared the token when it belonged to this
      // session (and emitted expiry); never clear a login that raced it.
      throw await toApiError(response);
    }
    return execute<T>(path, { ...options, refreshed: true });
  }

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  name?: string;
  avatarUrl?: string | null;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface AcceptInviteInput {
  token: string;
  name?: string;
  password?: string;
}

export interface InvitePreview {
  email: string;
  workspaceName: string;
  role: Role;
  invitedByName: string | null;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
}

export interface CreateCompanyInput {
  name: string;
  customerType?: CustomerType;
  domain?: string | null;
  industry?: Industry | null;
  size?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string[];
  archived?: boolean;
  ownerId?: string | null;
}

export type UpdateCompanyInput = Partial<CreateCompanyInput>;

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyId?: string | null;
  tags?: string[];
  archived?: boolean;
  ownerId?: string | null;
}

export type UpdateContactInput = Partial<CreateContactInput>;

export interface CreateDealInput {
  title: string;
  value: number;
  currency?: Currency;
  stageId: string;
  contactId?: string | null;
  companyId?: string | null;
  expectedCloseDate?: string | null;
  description?: string | null;
  tags?: string[];
  ownerId?: string | null;
}

export type UpdateDealInput = Partial<CreateDealInput>;

export interface CreateActivityInput {
  type?: ActivityType;
  title: string;
  body?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export type UpdateActivityInput = Partial<CreateActivityInput>;

export interface CreatePipelineInput {
  name: string;
}

export interface UpdatePipelineInput {
  name?: string;
  isDefault?: boolean;
}

export interface CreateStageInput {
  name: string;
  probability: number;
  kind?: StageKind;
  targetDays?: number;
}

export type UpdateStageInput = Partial<CreateStageInput>;

export interface CreateInviteInput {
  email: string;
  role?: "ADMIN" | "MEMBER";
}

export interface CreateLocationInput {
  customerId: string;
  label?: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  accessNotes?: string | null;
  gateCode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isPrimary?: boolean;
  archived?: boolean;
}

export type UpdateLocationInput = Partial<Omit<CreateLocationInput, "customerId">>;

export interface CreateServiceInput {
  name: string;
  category?: string | null;
  description?: string | null;
  unit?: ServiceUnit;
  durationMinutes?: number;
  price?: number;
  cost?: number;
  taxable?: boolean;
  archived?: boolean;
}

export type UpdateServiceInput = Partial<CreateServiceInput>;

export interface LineItemInput {
  serviceId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
}

export interface CreateJobInput {
  title: string;
  customerId: string;
  locationId: string;
  contactId?: string | null;
  assigneeId?: string | null;
  status?: JobStatus;
  priority?: JobPriority;
  source?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  durationMinutes?: number;
  taxRate?: number;
  deposit?: number;
  notes?: string | null;
  recurrence?: RecurrenceFrequency | null;
  recurrenceUntil?: string | null;
  lineItems?: LineItemInput[];
}

export type UpdateJobInput = Partial<CreateJobInput> & {
  rating?: number | null;
  ratingNote?: string | null;
  cancelReason?: string | null;
};

export interface CreateEstimateInput {
  title: string;
  customerId: string;
  locationId: string;
  contactId?: string | null;
  status?: EstimateStatus;
  issuedAt?: string | null;
  expiresAt?: string | null;
  taxRate?: number;
  notes?: string | null;
  lineItems?: LineItemInput[];
}

export type UpdateEstimateInput = Partial<CreateEstimateInput>;

export interface CreateInvoiceInput {
  title: string;
  jobId?: string | null;
  customerId?: string | null;
  locationId?: string | null;
  status?: InvoiceStatus;
  amount?: number;
  issuedAt?: string | null;
  dueAt?: string | null;
  notes?: string | null;
}

export type UpdateInvoiceInput = {
  title?: string;
  status?: InvoiceStatus;
  amount?: number;
  amountPaid?: number;
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
};

export interface CreateCommunicationInput {
  channel: CommunicationChannel;
  direction?: CommunicationDirection;
  status?: CommunicationStatus;
  intent?: CommunicationIntent;
  sentiment?: CommunicationSentiment;
  subject?: string | null;
  body?: string | null;
  customerId?: string | null;
  contactId?: string | null;
  jobId?: string | null;
  occurredAt?: string | null;
  aiGenerated?: boolean;
  aiRationale?: string | null;
}

export interface UpdateCommunicationInput {
  readAt?: string | null;
  sentiment?: CommunicationSentiment;
}

export interface DraftCommunicationInput {
  customerId: string;
  channel?: CommunicationChannel;
  intent?: CommunicationIntent;
  jobId?: string | null;
  tone?: "WARM" | "PROFESSIONAL" | "BRIEF";
}

export interface CreateExpenseInput {
  category?: ExpenseCategory;
  vendor?: string | null;
  description: string;
  amount: number;
  incurredAt?: string | null;
  jobId?: string | null;
  userId?: string | null;
  receiptUrl?: string | null;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface CreatePaymentInput {
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  receivedAt?: string | null;
}

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  trigger: AutomationTrigger;
  conditions?: AutomationConditions;
  actions: AutomationAction[];
  enabled?: boolean;
};

export type UpdateAutomationInput = Partial<CreateAutomationInput>;

/* List query shapes — every value is optional and omitted when empty. */
export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export type ArchiveFilter = "active" | "archived" | "all";

export interface CompanyListQuery extends ListParams {
  archive?: ArchiveFilter;
  industry?: Industry;
  customerType?: CustomerType;
}

export interface ContactListQuery extends ListParams {
  archive?: ArchiveFilter;
  companyId?: string;
}

export type DealStatusFilter = "open" | "won" | "lost" | "all";

export interface DealListQuery extends ListParams {
  pipelineId?: string;
  stageId?: string;
  companyId?: string;
  contactId?: string;
  ownerId?: string;
  status?: DealStatusFilter;
}

export interface ActivityListQuery extends ListParams {
  type?: ActivityType;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  completed?: boolean;
  due?: "overdue" | "today" | "week" | "all";
}

export interface AuditQuery extends ListParams {
  action?: string;
  entityType?: string;
  actorId?: string;
}

export interface LocationListQuery extends ListParams {
  archive?: ArchiveFilter;
  customerId?: string;
}

export interface ServiceListQuery extends ListParams {
  archive?: ArchiveFilter;
  category?: string;
  unit?: ServiceUnit;
}

export type JobScope = "all" | "open" | "today" | "week" | "unscheduled" | "upcoming";

export interface JobListQuery extends ListParams {
  status?: JobStatus;
  scope?: JobScope;
  customerId?: string;
  locationId?: string;
  assigneeId?: string;
  from?: string;
  to?: string;
}

export interface EstimateListQuery extends ListParams {
  status?: EstimateStatus;
  customerId?: string;
  open?: "true" | "false";
}

export interface InvoiceListQuery extends ListParams {
  status?: InvoiceStatus;
  customerId?: string;
  jobId?: string;
  overdue?: "true" | "false";
}

export interface CommunicationListQuery extends ListParams {
  channel?: CommunicationChannel;
  direction?: CommunicationDirection;
  customerId?: string;
  contactId?: string;
  jobId?: string;
  unread?: "true" | "false";
}

export interface DispatchQuery {
  date?: string;
  assigneeId?: string;
}

export interface FinanceQuery {
  from?: string;
  to?: string;
}

export interface ExpenseListQuery extends ListParams {
  category?: ExpenseCategory;
  jobId?: string;
  from?: string;
  to?: string;
}

export interface PaymentListQuery extends ListParams {
  from?: string;
  to?: string;
  customerId?: string;
  invoiceId?: string;
}

export interface AutomationListQuery extends ListParams {
  trigger?: AutomationTrigger;
  enabled?: "true" | "false";
}

export interface AutomationRunListQuery extends ListParams {
  trigger?: AutomationTrigger;
  status?: AutomationRunStatus;
  ruleId?: string;
}

export interface RecommendationListQuery {
  kind?: RecommendationKind;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * Rotates the session using the httpOnly refresh cookie. Concurrent callers
 * (including 401 retries from data requests) share one in-flight request.
 * A failed refresh clears the access token and, if one existed, notifies
 * `onSessionExpired` subscribers once.
 */
export function refreshSession(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    const tokenAtStart = accessToken;
    refreshInFlight = execute<RefreshResult>("/auth/refresh", {
      method: "POST",
      skipAuth: true,
      skipRefresh: true,
    })
      .then((result) => {
        // A login may have completed while the cookie refresh was in flight.
        if (accessToken === tokenAtStart) setAccessToken(result.accessToken);
        return result;
      })
      .catch((error: unknown) => {
        // A login may have completed while the cookie refresh was in flight;
        // its fresh session must survive this stale failure.
        if (accessToken === tokenAtStart) {
          setAccessToken(null);
          // Concurrent 401 retries share this one attempt, so a session that
          // had a token emits expiry exactly once.
          if (tokenAtStart !== null) emitSessionExpired();
        }
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function storeSession(session: AuthSession): AuthSession {
  setAccessToken(session.accessToken);
  return session;
}

const auth = {
  register: async (input: RegisterInput): Promise<AuthSession> =>
    storeSession(
      await execute<AuthSession>("/auth/register", { method: "POST", body: input }),
    ),
  login: async (input: LoginInput): Promise<AuthSession> =>
    storeSession(await execute<AuthSession>("/auth/login", { method: "POST", body: input })),
  refresh: refreshSession,
  logout: async (): Promise<void> => {
    try {
      await execute<void>("/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
    }
  },
  me: (): Promise<MeResponse> => execute<MeResponse>("/auth/me"),
  updateProfile: async (input: UpdateProfileInput): Promise<PublicUser> => {
    const result = await execute<PublicUser | { user: PublicUser }>("/auth/me", {
      method: "PATCH",
      body: input,
    });
    return "user" in result ? result.user : result;
  },
  changePassword: (input: ChangePasswordInput): Promise<void> =>
    execute<void>("/auth/password", { method: "POST", body: input }),
  getInvite: (token: string): Promise<InvitePreview> =>
    execute<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: async (input: AcceptInviteInput): Promise<AuthSession> =>
    storeSession(
      await execute<AuthSession>("/auth/accept-invite", {
        method: "POST",
        body: { token: input.token, name: input.name, password: input.password },
      }),
    ),
};

/* -------------------------------------------------------------------------- */
/* Workspace                                                                   */
/* -------------------------------------------------------------------------- */

const workspace = {
  get: (): Promise<WorkspaceSummary> => execute<WorkspaceSummary>("/workspace"),
  update: (input: {
    name?: string;
    currency?: Currency;
    businessType?: BusinessType;
    timezone?: string;
    serviceArea?: string | null;
    depotLatitude?: number | null;
    depotLongitude?: number | null;
  }): Promise<WorkspaceSummary> =>
    execute<WorkspaceSummary>("/workspace", { method: "PATCH", body: input }),
  members: (): Promise<Member[]> => execute<Member[]>("/workspace/members"),
  updateMember: (id: string, input: { role: "ADMIN" | "MEMBER" }): Promise<Member> =>
    execute<Member>(`/workspace/members/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  removeMember: (id: string): Promise<void> =>
    execute<void>(`/workspace/members/${encodeURIComponent(id)}`, { method: "DELETE" }),
  invites: (): Promise<Invite[]> => execute<Invite[]>("/workspace/invites"),
  createInvite: (
    input: CreateInviteInput,
  ): Promise<{ invite: Invite; token: string; inviteUrl: string }> =>
    execute<{ invite: Invite; token: string; inviteUrl: string }>("/workspace/invites", {
      method: "POST",
      body: input,
    }),
  revokeInvite: (id: string): Promise<void> =>
    execute<void>(`/workspace/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
  audit: (query?: AuditQuery): Promise<Page<AuditEntry>> =>
    execute<Page<AuditEntry>>("/workspace/audit", { query }),
};

/* -------------------------------------------------------------------------- */
/* Companies / contacts                                                        */
/* -------------------------------------------------------------------------- */

const companies = {
  list: (query?: CompanyListQuery): Promise<Page<Company>> =>
    execute<Page<Company>>("/companies", { query }),
  create: (input: CreateCompanyInput): Promise<Company> =>
    execute<Company>("/companies", { method: "POST", body: input }),
  get: (id: string): Promise<Company> => execute<Company>(`/companies/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateCompanyInput): Promise<Company> =>
    execute<Company>(`/companies/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  archive: (id: string): Promise<void> =>
    execute<void>(`/companies/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (id: string): Promise<Company> =>
    execute<Company>(`/companies/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  timeline: (id: string, limit = 80): Promise<CustomerTimeline> =>
    execute<CustomerTimeline>(`/companies/${encodeURIComponent(id)}/timeline`, {
      query: { limit },
    }),
};

const contacts = {
  list: (query?: ContactListQuery): Promise<Page<Contact>> =>
    execute<Page<Contact>>("/contacts", { query }),
  create: (input: CreateContactInput): Promise<Contact> =>
    execute<Contact>("/contacts", { method: "POST", body: input }),
  get: (id: string): Promise<Contact> => execute<Contact>(`/contacts/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateContactInput): Promise<Contact> =>
    execute<Contact>(`/contacts/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  archive: (id: string): Promise<void> =>
    execute<void>(`/contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (id: string): Promise<Contact> =>
    execute<Contact>(`/contacts/${encodeURIComponent(id)}/restore`, { method: "POST" }),
};

/* -------------------------------------------------------------------------- */
/* Deals / pipelines                                                           */
/* -------------------------------------------------------------------------- */

const deals = {
  list: (query?: DealListQuery): Promise<Page<Deal>> => execute<Page<Deal>>("/deals", { query }),
  create: (input: CreateDealInput): Promise<Deal> =>
    execute<Deal>("/deals", { method: "POST", body: input }),
  get: (id: string): Promise<Deal> => execute<Deal>(`/deals/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateDealInput): Promise<Deal> =>
    execute<Deal>(`/deals/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/deals/${encodeURIComponent(id)}`, { method: "DELETE" }),
  moveStage: (id: string, stageId: string): Promise<Deal> =>
    execute<Deal>(`/deals/${encodeURIComponent(id)}/stage`, {
      method: "PATCH",
      body: { stageId },
    }),
  history: (id: string): Promise<StageHistoryEntry[]> =>
    execute<StageHistoryEntry[]>(`/deals/${encodeURIComponent(id)}/history`),
};

const pipelines = {
  list: (): Promise<Pipeline[]> => execute<Pipeline[]>("/pipelines"),
  create: (input: CreatePipelineInput): Promise<Pipeline> =>
    execute<Pipeline>("/pipelines", { method: "POST", body: input }),
  update: (id: string, input: UpdatePipelineInput): Promise<Pipeline> =>
    execute<Pipeline>(`/pipelines/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  createStage: (pipelineId: string, input: CreateStageInput): Promise<Stage> =>
    execute<Stage>(`/pipelines/${encodeURIComponent(pipelineId)}/stages`, {
      method: "POST",
      body: input,
    }),
  updateStage: (stageId: string, input: UpdateStageInput): Promise<Stage> =>
    execute<Stage>(`/stages/${encodeURIComponent(stageId)}`, { method: "PATCH", body: input }),
  deleteStage: (stageId: string): Promise<void> =>
    execute<void>(`/stages/${encodeURIComponent(stageId)}`, { method: "DELETE" }),
  reorderStages: (pipelineId: string, stageIds: string[]): Promise<Pipeline> =>
    execute<Pipeline>(`/pipelines/${encodeURIComponent(pipelineId)}/stages/reorder`, {
      method: "POST",
      body: { stageIds },
    }),
};

/* -------------------------------------------------------------------------- */
/* Service operations                                                          */
/* -------------------------------------------------------------------------- */

const locations = {
  list: (query?: LocationListQuery): Promise<Page<Location>> =>
    execute<Page<Location>>("/locations", { query }),
  create: (input: CreateLocationInput): Promise<Location> =>
    execute<Location>("/locations", { method: "POST", body: input }),
  get: (id: string): Promise<Location> =>
    execute<Location>(`/locations/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateLocationInput): Promise<Location> =>
    execute<Location>(`/locations/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  archive: (id: string): Promise<void> =>
    execute<void>(`/locations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (id: string): Promise<Location> =>
    execute<Location>(`/locations/${encodeURIComponent(id)}/restore`, { method: "POST" }),
};

const services = {
  list: (query?: ServiceListQuery): Promise<Page<ServiceItem>> =>
    execute<Page<ServiceItem>>("/services", { query }),
  create: (input: CreateServiceInput): Promise<ServiceItem> =>
    execute<ServiceItem>("/services", { method: "POST", body: input }),
  get: (id: string): Promise<ServiceItem> =>
    execute<ServiceItem>(`/services/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateServiceInput): Promise<ServiceItem> =>
    execute<ServiceItem>(`/services/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  archive: (id: string): Promise<void> =>
    execute<void>(`/services/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (id: string): Promise<ServiceItem> =>
    execute<ServiceItem>(`/services/${encodeURIComponent(id)}/restore`, { method: "POST" }),
};

const jobs = {
  list: (query?: JobListQuery): Promise<Page<Job>> => execute<Page<Job>>("/jobs", { query }),
  create: (input: CreateJobInput): Promise<Job> =>
    execute<Job>("/jobs", { method: "POST", body: input }),
  get: (id: string): Promise<Job> => execute<Job>(`/jobs/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateJobInput): Promise<Job> =>
    execute<Job>(`/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  setStatus: (id: string, status: JobStatus, cancelReason?: string): Promise<Job> =>
    execute<Job>(`/jobs/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: { status, cancelReason },
    }),
  duplicate: (id: string, scheduledStart?: string | null): Promise<Job> =>
    execute<Job>(`/jobs/${encodeURIComponent(id)}/duplicate`, {
      method: "POST",
      body: { scheduledStart },
    }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const estimates = {
  list: (query?: EstimateListQuery): Promise<Page<Estimate>> =>
    execute<Page<Estimate>>("/estimates", { query }),
  create: (input: CreateEstimateInput): Promise<Estimate> =>
    execute<Estimate>("/estimates", { method: "POST", body: input }),
  get: (id: string): Promise<Estimate> =>
    execute<Estimate>(`/estimates/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateEstimateInput): Promise<Estimate> =>
    execute<Estimate>(`/estimates/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  setStatus: (id: string, status: EstimateStatus): Promise<Estimate> =>
    execute<Estimate>(`/estimates/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: { status },
    }),
  convert: (
    id: string,
    input?: { scheduledStart?: string | null; assigneeId?: string | null },
  ): Promise<Job> =>
    execute<Job>(`/estimates/${encodeURIComponent(id)}/convert`, {
      method: "POST",
      body: input ?? {},
    }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/estimates/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const invoices = {
  list: (query?: InvoiceListQuery): Promise<Page<Invoice>> =>
    execute<Page<Invoice>>("/invoices", { query }),
  create: (input: CreateInvoiceInput): Promise<Invoice> =>
    execute<Invoice>("/invoices", { method: "POST", body: input }),
  get: (id: string): Promise<Invoice> =>
    execute<Invoice>(`/invoices/${encodeURIComponent(id)}`),
  update: (id: string, input: UpdateInvoiceInput): Promise<Invoice> =>
    execute<Invoice>(`/invoices/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  recordPayment: (id: string, amountPaid: number, method?: PaymentMethod): Promise<Invoice> =>
    execute<Invoice>(`/invoices/${encodeURIComponent(id)}/payment`, {
      method: "PATCH",
      body: { amountPaid, method },
    }),
  addPayment: (id: string, input: CreatePaymentInput): Promise<Invoice> =>
    execute<Invoice>(`/invoices/${encodeURIComponent(id)}/payments`, {
      method: "POST",
      body: input,
    }),
  payments: (id: string): Promise<Payment[]> =>
    execute<Payment[]>(`/invoices/${encodeURIComponent(id)}/payments`),
  delete: (id: string): Promise<void> =>
    execute<void>(`/invoices/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const ops = {
  summary: (date?: string): Promise<OpsSummary> =>
    execute<OpsSummary>("/ops/summary", { query: { date } }),
};

const communications = {
  list: (query?: CommunicationListQuery): Promise<Page<Communication>> =>
    execute<Page<Communication>>("/communications", { query }),
  threads: (query?: { q?: string; limit?: number }): Promise<CommunicationThread[]> =>
    execute<CommunicationThread[]>("/communications/threads", { query }),
  stats: (): Promise<CommunicationStats> => execute<CommunicationStats>("/communications/stats"),
  get: (id: string): Promise<Communication> =>
    execute<Communication>(`/communications/${encodeURIComponent(id)}`),
  create: (input: CreateCommunicationInput): Promise<Communication> =>
    execute<Communication>("/communications", { method: "POST", body: input }),
  update: (id: string, input: UpdateCommunicationInput): Promise<Communication> =>
    execute<Communication>(`/communications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  draft: (input: DraftCommunicationInput): Promise<CommunicationDraft> =>
    execute<CommunicationDraft>("/communications/draft", { method: "POST", body: input }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/communications/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const dispatch = {
  board: (query?: DispatchQuery): Promise<DispatchBoard> =>
    execute<DispatchBoard>("/dispatch/board", { query }),
  map: (query?: DispatchQuery): Promise<DispatchMap> =>
    execute<DispatchMap>("/dispatch/map", { query }),
  route: (query?: DispatchQuery & { assigneeId: string }): Promise<DispatchRoute> =>
    execute<DispatchRoute>("/dispatch/route", { query }),
  assign: (jobIds: string[], assigneeId: string | null): Promise<{ updated: number }> =>
    execute<{ updated: number }>("/dispatch/assign", {
      method: "POST",
      body: { jobIds, assigneeId },
    }),
};

const finance = {
  summary: (query?: FinanceQuery): Promise<FinanceSummary> =>
    execute<FinanceSummary>("/finance/summary", { query }),
  payments: (query?: PaymentListQuery): Promise<Page<Payment>> =>
    execute<Page<Payment>>("/finance/payments", { query }),
  expenses: (query?: ExpenseListQuery): Promise<Page<Expense>> =>
    execute<Page<Expense>>("/finance/expenses", { query }),
  createExpense: (input: CreateExpenseInput): Promise<Expense> =>
    execute<Expense>("/finance/expenses", { method: "POST", body: input }),
  updateExpense: (id: string, input: UpdateExpenseInput): Promise<Expense> =>
    execute<Expense>(`/finance/expenses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  deleteExpense: (id: string): Promise<void> =>
    execute<void>(`/finance/expenses/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const automations = {
  list: (query?: AutomationListQuery): Promise<Page<AutomationRule>> =>
    execute<Page<AutomationRule>>("/automations", { query }),
  get: (id: string): Promise<AutomationRule> =>
    execute<AutomationRule>(`/automations/${encodeURIComponent(id)}`),
  create: (input: CreateAutomationInput): Promise<AutomationRule> =>
    execute<AutomationRule>("/automations", { method: "POST", body: input }),
  update: (id: string, input: UpdateAutomationInput): Promise<AutomationRule> =>
    execute<AutomationRule>(`/automations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/automations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runs: (query?: AutomationRunListQuery): Promise<Page<AutomationRun>> =>
    execute<Page<AutomationRun>>("/automations/runs", { query }),
  runDue: (): Promise<{ evaluated: number; run: number }> =>
    execute<{ evaluated: number; run: number }>("/automations/run-due", { method: "POST" }),
};

const intelligence = {
  summary: (): Promise<IntelligenceSummary> => execute<IntelligenceSummary>("/intelligence/summary"),
  recommendations: (query?: RecommendationListQuery): Promise<Recommendation[]> =>
    execute<Recommendation[]>("/intelligence/recommendations", { query }),
  brief: (): Promise<AssistantBrief> => execute<AssistantBrief>("/intelligence/brief"),
};

const team = {
  performance: (query?: FinanceQuery): Promise<TeamPerformance> =>
    execute<TeamPerformance>("/team/performance", { query }),
  workload: (date?: string): Promise<TeamWorkload> =>
    execute<TeamWorkload>("/team/workload", { query: { date } }),
};

/* -------------------------------------------------------------------------- */
/* Activities / insights                                                       */
/* -------------------------------------------------------------------------- */

const activities = {
  list: (query?: ActivityListQuery): Promise<Page<Activity>> =>
    execute<Page<Activity>>("/activities", { query }),
  create: (input: CreateActivityInput): Promise<Activity> =>
    execute<Activity>("/activities", { method: "POST", body: input }),
  update: (id: string, input: UpdateActivityInput): Promise<Activity> =>
    execute<Activity>(`/activities/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  delete: (id: string): Promise<void> =>
    execute<void>(`/activities/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const insights = {
  dashboard: (months?: number): Promise<DashboardSummary> =>
    execute<DashboardSummary>("/dashboard", { query: { months } }),
  search: (q: string): Promise<SearchResponse> => execute<SearchResponse>("/search", { query: { q } }),
};

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

export const api = {
  auth,
  workspace,
  companies,
  contacts,
  deals,
  pipelines,
  locations,
  services,
  jobs,
  estimates,
  invoices,
  ops,
  communications,
  dispatch,
  finance,
  automations,
  intelligence,
  team,
  activities,
  insights,
};

export type Api = typeof api;

export type {
  Activity,
  ActivityType,
  AssistantBrief,
  AuditEntry,
  AuthSession,
  AutomationAction,
  AutomationConditions,
  AutomationRun,
  AutomationRule,
  BusinessType,
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationDraft,
  CommunicationIntent,
  CommunicationSentiment,
  CommunicationStats,
  CommunicationStatus,
  CommunicationThread,
  Company,
  Contact,
  Currency,
  CustomerTimeline,
  CustomerType,
  DashboardSummary,
  Deal,
  DispatchBoard,
  DispatchMap,
  DispatchRoute,
  Estimate,
  EstimateStatus,
  Expense,
  ExpenseCategory,
  FinanceSummary,
  Industry,
  IntelligenceSummary,
  Invite,
  Invoice,
  InvoiceStatus,
  Job,
  JobPriority,
  JobStatus,
  Location,
  MeResponse,
  Member,
  OpsSummary,
  Page,
  Payment,
  PaymentMethod,
  Pipeline,
  PublicUser,
  Recommendation,
  RecommendationKind,
  RecurrenceFrequency,
  Role,
  SearchResponse,
  ServiceItem,
  ServiceUnit,
  Stage,
  StageHistoryEntry,
  StageKind,
  TeamPerformance,
  TeamWorkload,
  WorkspaceSummary,
};
