import type { AutomationTrigger } from "@meridian/contracts";
import { processEvent } from "./automation.js";

/**
 * A domain event fired by a core write path (jobs, invoices, estimates,
 * companies). It is an in-process bus: `emitEvent` hands the event to the
 * automation engine synchronously, but never lets an automation failure
 * surface as a failure of the write that triggered it.
 */
export interface DomainEvent {
  workspaceId: string;
  type: AutomationTrigger;
  entityType: "job" | "invoice" | "estimate" | "company";
  entityId: string;
  actorId?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  estimateId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Fan an event out to matching automation rules. Rules are isolated from each
 * other inside the engine, and this boundary guarantees an automation problem
 * can never fail the caller's write.
 */
export async function emitEvent(event: DomainEvent): Promise<void> {
  try {
    await processEvent(event);
  } catch (error) {
    console.error(
      `automation event ${event.type} for ${event.entityType}:${event.entityId} failed`,
      error,
    );
  }
}
