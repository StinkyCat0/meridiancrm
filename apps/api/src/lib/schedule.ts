import type { Prisma } from "@prisma/client";
import { conflict, iso } from "./http.js";

export interface ScheduleConflictInput {
  workspaceId: string;
  assigneeId: string | null;
  start: Date | null;
  end: Date | null;
  excludeJobId?: string;
}

/**
 * Two jobs scheduling the same technician cannot overlap. Canceled and no-show
 * work releases its slot; every other status still occupies it. Jobs without
 * an assignee or a window never conflict, and a zero-length window is treated
 * as no window at all.
 */
export async function assertNoScheduleConflict(
  tx: Prisma.TransactionClient,
  input: ScheduleConflictInput,
): Promise<void> {
  const { workspaceId, assigneeId, start, end, excludeJobId } = input;
  if (!assigneeId || !start || !end) return;
  if (end.getTime() <= start.getTime()) return;

  const overlapping = await tx.job.findFirst({
    where: {
      workspaceId,
      assigneeId,
      status: { notIn: ["CANCELED", "NO_SHOW"] },
      scheduledStart: { lt: end },
      scheduledEnd: { gt: start },
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
    select: {
      id: true,
      number: true,
      title: true,
      scheduledStart: true,
      scheduledEnd: true,
    },
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
  });
  if (!overlapping) return;

  throw conflict(
    `This technician is already assigned to ${overlapping.number} at that time`,
    {
      jobId: overlapping.id,
      jobNumber: overlapping.number,
      title: overlapping.title,
      scheduledStart: iso(overlapping.scheduledStart),
      scheduledEnd: iso(overlapping.scheduledEnd),
      requestedStart: start.toISOString(),
      requestedEnd: end.toISOString(),
    },
  );
}
