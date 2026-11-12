import type {
  AutomationAction,
  AutomationConditions,
  AutomationRule,
  AutomationRun,
  AutomationRunStatus,
  BusinessType,
  CommunicationChannel,
  CommunicationIntent,
  CustomerType,
  JobPriority,
} from "@meridian/contracts";
import {
  BUSINESS_TYPE_META,
  automationActionSchema,
  automationConditionSchema,
  buildMessageDraft,
} from "@meridian/contracts";
import type {
  AutomationRule as AutomationRuleRow,
  AutomationRun as AutomationRunRow,
  Prisma,
} from "@prisma/client";
import { prisma } from "./db.js";
import type { DomainEvent } from "./events.js";
import { iso, parseTags } from "./http.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Caps a single run-due sweep so a large backlog cannot stall the request. */
const MAX_CANDIDATES = 200;
const MAX_DETAIL = 1_000;

/* -------------------------------------------------------------------------- */
/* Row serialization                                                          */
/* -------------------------------------------------------------------------- */

function safeConditions(raw: string): AutomationConditions {
  try {
    const parsed = automationConditionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function safeActions(raw: string): AutomationAction[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = automationActionSchema.array().safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function toAutomationRule(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger: row.trigger as AutomationRule["trigger"],
    conditions: safeConditions(row.conditions),
    actions: safeActions(row.actions),
    enabled: row.enabled,
    runCount: row.runCount,
    lastRunAt: iso(row.lastRunAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type AutomationRunWithRule = AutomationRunRow & { rule: { name: string } };

export function toAutomationRun(row: AutomationRunWithRule): AutomationRun {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.rule.name,
    trigger: row.trigger as AutomationRun["trigger"],
    status: row.status as AutomationRunStatus,
    entityType: row.entityType,
    entityId: row.entityId,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Event context                                                              */
/* -------------------------------------------------------------------------- */

interface WorkspaceContext {
  id: string;
  name: string;
  businessType: string;
  serviceArea: string | null;
  currency: string;
}

interface CompanyContext {
  id: string;
  name: string;
  customerType: string;
  ownerId: string | null;
  tags: string;
}

interface JobContext {
  id: string;
  number: string;
  title: string;
  priority: string;
  scheduledStart: Date | null;
  customerId: string;
  contactId: string | null;
  assigneeId: string | null;
  total: number;
}

interface ContactContext {
  id: string;
  firstName: string;
  lastName: string;
}

interface InvoiceContext {
  id: string;
  amount: number;
  amountPaid: number;
  customerId: string;
  jobId: string | null;
}

interface EstimateContext {
  id: string;
  total: number;
  customerId: string;
  contactId: string | null;
  jobId: string | null;
}

interface EventContext {
  workspace: WorkspaceContext;
  customer: CompanyContext | null;
  job: JobContext | null;
  contact: ContactContext | null;
  invoice: InvoiceContext | null;
  estimate: EstimateContext | null;
  entityTotal: number | null;
  ownerId: string | null;
}

async function loadCompany(workspaceId: string, id: string): Promise<CompanyContext | null> {
  return prisma.company.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      name: true,
      customerType: true,
      ownerId: true,
      tags: true,
    },
  });
}

async function loadJob(workspaceId: string, id: string): Promise<JobContext | null> {
  return prisma.job.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      number: true,
      title: true,
      priority: true,
      scheduledStart: true,
      customerId: true,
      contactId: true,
      assigneeId: true,
      total: true,
    },
  });
}

async function loadContact(workspaceId: string, id: string): Promise<ContactContext | null> {
  return prisma.contact.findFirst({
    where: { id, workspaceId },
    select: { id: true, firstName: true, lastName: true },
  });
}

async function loadInvoice(workspaceId: string, id: string): Promise<InvoiceContext | null> {
  return prisma.invoice.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      amount: true,
      amountPaid: true,
      customerId: true,
      jobId: true,
    },
  });
}

async function loadEstimate(workspaceId: string, id: string): Promise<EstimateContext | null> {
  return prisma.estimate.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      total: true,
      customerId: true,
      contactId: true,
      jobId: true,
    },
  });
}

/**
 * Resolves everything an action needs once per event, so every rule evaluated
 * for that event shares the same tenant-scoped snapshot.
 */
async function loadEventContext(event: DomainEvent): Promise<EventContext | null> {
  const [workspace, primaryJob, primaryInvoice, primaryEstimate] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: event.workspaceId },
      select: { id: true, name: true, businessType: true, serviceArea: true, currency: true },
    }),
    event.entityType === "job" ? loadJob(event.workspaceId, event.entityId) : Promise.resolve(null),
    event.entityType === "invoice"
      ? loadInvoice(event.workspaceId, event.entityId)
      : Promise.resolve(null),
    event.entityType === "estimate"
      ? loadEstimate(event.workspaceId, event.entityId)
      : Promise.resolve(null),
  ]);
  if (!workspace) return null;

  const jobId =
    event.jobId ??
    primaryInvoice?.jobId ??
    primaryEstimate?.jobId ??
    primaryJob?.id ??
    null;
  const invoiceId = event.invoiceId ?? primaryInvoice?.id ?? null;
  const estimateId = event.estimateId ?? primaryEstimate?.id ?? null;

  const [job, invoice, estimate] = await Promise.all([
    primaryJob ?? (jobId ? loadJob(event.workspaceId, jobId) : Promise.resolve(null)),
    primaryInvoice ??
      (invoiceId ? loadInvoice(event.workspaceId, invoiceId) : Promise.resolve(null)),
    primaryEstimate ??
      (estimateId ? loadEstimate(event.workspaceId, estimateId) : Promise.resolve(null)),
  ]);

  const customerId =
    event.customerId ??
    invoice?.customerId ??
    estimate?.customerId ??
    job?.customerId ??
    (event.entityType === "company" ? event.entityId : null);
  const contactId = job?.contactId ?? estimate?.contactId ?? null;

  const [customer, contact] = await Promise.all([
    customerId ? loadCompany(event.workspaceId, customerId) : Promise.resolve(null),
    contactId ? loadContact(event.workspaceId, contactId) : Promise.resolve(null),
  ]);

  return {
    workspace,
    customer,
    job,
    contact,
    invoice,
    estimate,
    entityTotal: invoice?.amount ?? job?.total ?? estimate?.total ?? null,
    ownerId: event.actorId ?? job?.assigneeId ?? customer?.ownerId ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

interface ConditionVerdict {
  ok: boolean;
  reason: string | null;
}

function evaluateConditions(
  conditions: AutomationConditions,
  context: EventContext,
): ConditionVerdict {
  const { minTotal, customerTypes, priorities } = conditions;

  if (typeof minTotal === "number") {
    if (context.entityTotal === null) {
      return { ok: false, reason: `A minimum total of ${minTotal} needs a priced entity` };
    }
    if (context.entityTotal < minTotal) {
      return {
        ok: false,
        reason: `Total ${context.entityTotal} is below the minimum of ${minTotal}`,
      };
    }
  }

  if (customerTypes && customerTypes.length > 0) {
    if (!context.customer) {
      return { ok: false, reason: "A customer type condition needs a customer" };
    }
    if (!customerTypes.includes(context.customer.customerType as CustomerType)) {
      return {
        ok: false,
        reason: `Customer type ${context.customer.customerType} is not one of ${customerTypes.join(", ")}`,
      };
    }
  }

  if (priorities && priorities.length > 0) {
    if (!context.job) {
      return { ok: false, reason: "A priority condition needs a job" };
    }
    if (!priorities.includes(context.job.priority as JobPriority)) {
      return {
        ok: false,
        reason: `Job priority ${context.job.priority} is not one of ${priorities.join(", ")}`,
      };
    }
  }

  return { ok: true, reason: null };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

class ActionSkip extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionSkip";
  }
}

const PLACEHOLDER = /\{(customer|job|business)\}/g;

function applyPlaceholders(template: string, context: EventContext): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (key === "customer") return context.customer?.name ?? "there";
    if (key === "job") {
      return context.job ? `${context.job.title} (#${context.job.number})` : "your appointment";
    }
    return context.workspace.name;
  });
}

function businessTypeLabel(value: string): string {
  const meta = BUSINESS_TYPE_META[value as BusinessType];
  return meta?.label ?? BUSINESS_TYPE_META.GENERAL.label;
}

function amountLabel(cents: number | null, currency: string): string | null {
  if (cents === null) return null;
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function buildDraft(
  channel: CommunicationChannel,
  intent: CommunicationIntent,
  context: EventContext,
) {
  const contactName = context.contact
    ? `${context.contact.firstName} ${context.contact.lastName}`.trim()
    : null;
  return buildMessageDraft({
    customerName: context.customer?.name ?? "there",
    contactName,
    businessName: context.workspace.name,
    businessTypeLabel: businessTypeLabel(context.workspace.businessType),
    channel,
    intent,
    tone: "WARM",
    appointmentLabel: context.job?.scheduledStart
      ? context.job.scheduledStart.toISOString().slice(0, 10)
      : null,
    jobNumber: context.job?.number ?? null,
    serviceName: null,
    amountLabel: amountLabel(context.entityTotal, context.workspace.currency),
    serviceArea: context.workspace.serviceArea,
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

async function executeAction(
  tx: Prisma.TransactionClient,
  action: AutomationAction,
  context: EventContext,
  now: Date,
): Promise<string> {
  if (action.type === "CREATE_TASK") {
    const task = await tx.activity.create({
      data: {
        workspaceId: context.workspace.id,
        type: "TASK",
        title: truncate(action.title, 160),
        body: action.body ? applyPlaceholders(action.body, context) : null,
        dueAt: new Date(now.getTime() + (action.dueInHours ?? 24) * HOUR_MS),
        companyId: context.customer?.id ?? null,
        contactId: context.contact?.id ?? null,
        ownerId: context.ownerId,
      },
      select: { id: true },
    });
    return `task ${task.id} created`;
  }

  if (action.type === "SEND_MESSAGE") {
    if (!context.customer) throw new ActionSkip("no customer to message");
    const draft = action.body ? null : buildDraft(action.channel, action.intent, context);
    const body = action.body ? applyPlaceholders(action.body, context) : draft?.body ?? "";
    const subject = action.channel === "EMAIL" ? draft?.subject ?? null : null;

    const message = await tx.communication.create({
      data: {
        workspaceId: context.workspace.id,
        channel: action.channel,
        direction: "OUTBOUND",
        status: "SENT",
        intent: action.intent,
        sentiment: "NEUTRAL",
        subject,
        body,
        customerId: context.customer.id,
        contactId: context.contact?.id ?? null,
        jobId: context.job?.id ?? null,
        userId: context.ownerId,
        provider: "automation",
        aiGenerated: draft !== null,
        aiRationale: draft?.rationale ?? null,
      },
      select: { id: true },
    });
    return `message ${message.id} sent`;
  }

  if (action.type === "ADD_TAG") {
    if (!context.customer) throw new ActionSkip("no customer to tag");
    const tag = action.tag.trim();
    const current = await tx.company.findFirst({
      where: { id: context.customer.id, workspaceId: context.workspace.id },
      select: { tags: true },
    });
    if (!current) throw new ActionSkip("customer no longer exists");
    const tags = parseTags(current.tags);
    if (tags.includes(tag)) throw new ActionSkip(`tag ${tag} is already present`);
    const next = [...tags, tag].slice(0, 40);
    await tx.company.update({
      where: { id: context.customer.id },
      data: { tags: JSON.stringify(next) },
    });
    return `tag ${tag} added`;
  }

  if (!context.customer) throw new ActionSkip("no customer to request a review from");
  const draft = buildDraft(action.channel, "REVIEW", context);
  const message = await tx.communication.create({
    data: {
      workspaceId: context.workspace.id,
      channel: action.channel,
      direction: "OUTBOUND",
      status: "SENT",
      intent: "REVIEW",
      sentiment: "NEUTRAL",
      subject: action.channel === "EMAIL" ? draft.subject : null,
      body: draft.body,
      customerId: context.customer.id,
      contactId: context.contact?.id ?? null,
      jobId: context.job?.id ?? null,
      userId: context.ownerId,
      provider: "automation",
      aiGenerated: true,
      aiRationale: draft.rationale,
    },
    select: { id: true },
  });
  const task = await tx.activity.create({
    data: {
      workspaceId: context.workspace.id,
      type: "TASK",
      title: truncate(`Request a review from ${context.customer.name}`, 160),
      body: null,
      dueAt: new Date(now.getTime() + 48 * HOUR_MS),
      companyId: context.customer.id,
      contactId: context.contact?.id ?? null,
      ownerId: context.ownerId,
    },
    select: { id: true },
  });
  return `review message ${message.id} and request task ${task.id} created`;
}

/* -------------------------------------------------------------------------- */
/* Rule execution                                                             */
/* -------------------------------------------------------------------------- */

function dedupeWhere(
  rule: AutomationRuleRow,
  event: DomainEvent,
  now: Date,
): Prisma.AutomationRunWhereInput {
  return {
    workspaceId: event.workspaceId,
    ruleId: rule.id,
    trigger: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    createdAt: { gte: new Date(now.getTime() - DAY_MS) },
  };
}

/**
 * Runs one rule against one event. The dedupe check, actions and run log share
 * a transaction so a failure cannot leave half-applied side effects behind.
 * Returns true when a run row was written.
 */
async function runRule(
  rule: AutomationRuleRow,
  event: DomainEvent,
  context: EventContext,
): Promise<boolean> {
  const now = new Date();
  let written = false;

  try {
    await prisma.$transaction(async (tx) => {
      const duplicate = await tx.automationRun.findFirst({
        where: dedupeWhere(rule, event, now),
        select: { id: true },
      });
      if (duplicate) return;

      const increment = {
        runCount: { increment: 1 },
        lastRunAt: now,
      };

      const verdict = evaluateConditions(safeConditions(rule.conditions), context);
      if (!verdict.ok) {
        await tx.automationRun.create({
          data: {
            workspaceId: event.workspaceId,
            ruleId: rule.id,
            trigger: event.type,
            status: "SKIPPED",
            entityType: event.entityType,
            entityId: event.entityId,
            detail: truncate(verdict.reason ?? "Conditions not met", MAX_DETAIL),
            createdAt: now,
          },
        });
        await tx.automationRule.update({ where: { id: rule.id }, data: increment });
        written = true;
        return;
      }

      const actions = safeActions(rule.actions);
      if (actions.length === 0) {
        await tx.automationRun.create({
          data: {
            workspaceId: event.workspaceId,
            ruleId: rule.id,
            trigger: event.type,
            status: "SKIPPED",
            entityType: event.entityType,
            entityId: event.entityId,
            detail: "The rule has no runnable actions",
            createdAt: now,
          },
        });
        await tx.automationRule.update({ where: { id: rule.id }, data: increment });
        written = true;
        return;
      }

      const notes: string[] = [];
      const skips: string[] = [];
      for (const action of actions) {
        try {
          notes.push(await executeAction(tx, action, context, now));
        } catch (error) {
          if (error instanceof ActionSkip) {
            skips.push(error.message);
            continue;
          }
          throw error;
        }
      }

      const status: AutomationRunStatus = notes.length > 0 ? "SUCCESS" : "SKIPPED";
      const detail = [...notes, ...skips].join("; ");
      await tx.automationRun.create({
        data: {
          workspaceId: event.workspaceId,
          ruleId: rule.id,
          trigger: event.type,
          status,
          entityType: event.entityType,
          entityId: event.entityId,
          detail: detail ? truncate(detail, MAX_DETAIL) : null,
          createdAt: now,
        },
      });
      await tx.automationRule.update({ where: { id: rule.id }, data: increment });
      written = true;
    });
  } catch (error) {
    console.error(`automation rule ${rule.id} failed`, error);
    const detail = error instanceof Error ? error.message : "Automation run failed";
    try {
      await prisma.$transaction([
        prisma.automationRun.create({
          data: {
            workspaceId: event.workspaceId,
            ruleId: rule.id,
            trigger: event.type,
            status: "FAILED",
            entityType: event.entityType,
            entityId: event.entityId,
            detail: truncate(detail, MAX_DETAIL),
            createdAt: now,
          },
        }),
        prisma.automationRule.update({
          where: { id: rule.id },
          data: { runCount: { increment: 1 }, lastRunAt: now },
        }),
      ]);
      written = true;
    } catch (recordError) {
      console.error(`automation rule ${rule.id} failure could not be recorded`, recordError);
    }
  }

  return written;
}

/**
 * Evaluates every enabled rule for the event's trigger and entity. Rules are
 * isolated: one failing rule never blocks its siblings or the emitting write.
 * Returns the number of run rows written (including skips).
 */
export async function processEvent(event: DomainEvent): Promise<number> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: {
        workspaceId: event.workspaceId,
        trigger: event.type,
        enabled: true,
      },
    });
    if (rules.length === 0) return 0;

    const context = await loadEventContext(event);
    if (!context) return 0;

    let created = 0;
    for (const rule of rules) {
      try {
        if (await runRule(rule, event, context)) created += 1;
      } catch (error) {
        console.error(`automation rule ${rule.id} evaluation failed`, error);
      }
    }
    return created;
  } catch (error) {
    console.error(`automation event ${event.type} evaluation failed`, error);
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Scheduled sweep                                                            */
/* -------------------------------------------------------------------------- */

export interface RunDueResult {
  evaluated: number;
  run: number;
}

/**
 * Finds invoices that are past due with a balance and jobs scheduled in the
 * next 24 hours, then feeds them through the same event pipeline. Dedupe makes
 * repeated sweeps idempotent.
 */
export async function runDueAutomations(
  workspaceId: string,
  actorId: string | null,
): Promise<RunDueResult> {
  const now = new Date();
  const horizon = new Date(now.getTime() + DAY_MS);

  const [invoiceRows, jobRows] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        workspaceId,
        status: { in: ["SENT", "PARTIAL"] },
        dueAt: { lt: now },
      },
      select: {
        id: true,
        number: true,
        customerId: true,
        jobId: true,
        amount: true,
        amountPaid: true,
        dueAt: true,
      },
      orderBy: { dueAt: "asc" },
      take: MAX_CANDIDATES,
    }),
    prisma.job.findMany({
      where: {
        workspaceId,
        status: { in: ["SCHEDULED", "DISPATCHED"] },
        scheduledStart: { gte: now, lte: horizon },
      },
      select: {
        id: true,
        number: true,
        customerId: true,
        scheduledStart: true,
      },
      orderBy: { scheduledStart: "asc" },
      take: MAX_CANDIDATES,
    }),
  ]);

  const events: DomainEvent[] = [];
  for (const invoice of invoiceRows) {
    if (invoice.amount - invoice.amountPaid <= 0) continue;
    events.push({
      workspaceId,
      type: "INVOICE_OVERDUE",
      entityType: "invoice",
      entityId: invoice.id,
      actorId,
      customerId: invoice.customerId,
      jobId: invoice.jobId,
      invoiceId: invoice.id,
      payload: {
        number: invoice.number,
        balance: invoice.amount - invoice.amountPaid,
        dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
      },
    });
  }
  for (const job of jobRows) {
    events.push({
      workspaceId,
      type: "APPOINTMENT_UPCOMING",
      entityType: "job",
      entityId: job.id,
      actorId,
      customerId: job.customerId,
      jobId: job.id,
      payload: {
        number: job.number,
        scheduledStart: job.scheduledStart ? job.scheduledStart.toISOString() : null,
      },
    });
  }

  let run = 0;
  for (const event of events) {
    run += await processEvent(event);
  }

  return { evaluated: events.length, run };
}
