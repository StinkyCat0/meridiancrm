import type { Prisma } from "@prisma/client";
import {
  JOB_STATUS_META,
  JOB_STATUS_TRANSITIONS,
  type AutomationTrigger,
  type JobStatus,
} from "@meridian/contracts";
import { conflict, notFound } from "./http.js";
import { emitEvent, type DomainEvent } from "./events.js";

export interface ApplyJobStatusInput {
  workspaceId: string;
  actorId: string;
  jobId: string;
  status: JobStatus;
  cancelReason?: string | null;
}

const STATUS_EVENT: Partial<Record<JobStatus, AutomationTrigger>> = {
  COMPLETED: "JOB_COMPLETED",
  CANCELED: "JOB_CANCELED",
  NO_SHOW: "JOB_NO_SHOW",
};

const STATUS_ACTIVITY_TITLE: Partial<Record<JobStatus, string>> = {
  COMPLETED: "Completed",
  CANCELED: "Canceled",
  NO_SHOW: "No-show",
};

/**
 * Timestamps are derived from the target status so every write path (PATCH
 * /jobs/:id and PATCH /jobs/:id/status) produces identical rows.
 */
export function jobStatusTimestamps(
  status: JobStatus,
  existing: { arrivedAt: Date | null; completedAt: Date | null } = {
    arrivedAt: null,
    completedAt: null,
  },
) {
  const now = new Date();
  const arrivedAt =
    status === "IN_PROGRESS" || status === "COMPLETED"
      ? (existing.arrivedAt ?? now)
      : status === "UNSCHEDULED" || status === "SCHEDULED"
        ? null
        : existing.arrivedAt;
  const completedAt = status === "COMPLETED" ? (existing.completedAt ?? now) : null;
  return { arrivedAt, completedAt };
}

export interface ApplyJobStatusOptions {
  /**
   * Routes pass a collector and emit the events after `$transaction` resolves.
   * Without one the helper defers emission to the next tick so the write never
   * contends with the open SQLite transaction.
   */
  onEvent?: (event: DomainEvent) => void;
}

/**
 * Single source of truth for job lifecycle side effects. Callers must pass the
 * transaction that also writes the job so the status, timestamps, timeline
 * activity and audit row commit (or roll back) together. Domain events are
 * emitted after the transaction resolves: emitEvent writes automation runs via
 * the global Prisma client, which must not contend with an open SQLite
 * transaction.
 */
export async function applyJobStatus(
  tx: Prisma.TransactionClient,
  input: ApplyJobStatusInput,
  options: ApplyJobStatusOptions = {},
): Promise<void> {
  const job = await tx.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: {
      id: true,
      number: true,
      title: true,
      notes: true,
      status: true,
      customerId: true,
      contactId: true,
      assigneeId: true,
      arrivedAt: true,
      completedAt: true,
    },
  });
  if (!job) throw notFound("Job");

  const from = job.status as JobStatus;
  if (from === input.status) {
    // Same-status patches are no-ops; they must not duplicate timeline entries,
    // audits or domain events.
    if (input.status === "CANCELED" && input.cancelReason !== undefined) {
      await tx.job.update({
        where: { id: job.id },
        data: { cancelReason: input.cancelReason ?? null },
      });
    }
    return;
  }

  const allowed = JOB_STATUS_TRANSITIONS[from];
  if (!allowed.includes(input.status)) {
    throw conflict(
      `${JOB_STATUS_META[from].label} jobs cannot move to ${JOB_STATUS_META[input.status].label}`,
      { from, to: input.status, allowed },
    );
  }

  const stamps = jobStatusTimestamps(input.status, job);
  const now = new Date();
  await tx.job.update({
    where: { id: job.id },
    data: {
      status: input.status,
      ...stamps,
      ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason ?? null } : {}),
    },
  });

  const transitionLabel = STATUS_ACTIVITY_TITLE[input.status];
  if (transitionLabel) {
    const body =
      input.status === "COMPLETED"
        ? job.notes
        : (input.cancelReason ?? job.notes);
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        type: "NOTE",
        title: `${transitionLabel} ${job.number}: ${job.title}`,
        body: body ?? null,
        completedAt: now,
        companyId: job.customerId,
        contactId: job.contactId,
        ownerId: job.assigneeId ?? input.actorId,
      },
    });
  }

  await tx.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "job.status_changed",
      entityType: "job",
      entityId: job.id,
      metadata: JSON.stringify({ number: job.number, from, to: input.status }),
    },
  });

  const eventType = STATUS_EVENT[input.status];
  if (eventType) {
    const event = {
      workspaceId: input.workspaceId,
      type: eventType,
      entityType: "job" as const,
      entityId: job.id,
      actorId: input.actorId,
      customerId: job.customerId,
      jobId: job.id,
      payload: { number: job.number, status: input.status, from },
    };
    if (options.onEvent) {
      options.onEvent(event);
    } else {
      // No collector: defer past the caller's commit. emitEvent never throws
      // into the request.
      setImmediate(() => {
        void emitEvent(event);
      });
    }
  }
}
