import type { Prisma } from "@prisma/client";
import {
  invoiceIsOverdue,
  type CustomerSummary,
  type CustomerType,
  type InvoiceStatus,
  type LineItem,
  type LocationSummary,
  type RecurrenceFrequency,
} from "@meridian/contracts";
import { badRequest, conflict, notFound } from "./http.js";
import { prisma } from "./db.js";

export const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const customerSelect = {
  id: true,
  name: true,
  phone: true,
  customerType: true,
} satisfies Prisma.CompanySelect;

export const locationSummarySelect = {
  id: true,
  customerId: true,
  label: true,
  line1: true,
  city: true,
  state: true,
  postalCode: true,
} satisfies Prisma.LocationSelect;

export const contactSummarySelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
} satisfies Prisma.ContactSelect;

type CustomerRow = Prisma.CompanyGetPayload<{ select: typeof customerSelect }>;
type LocationRow = Prisma.LocationGetPayload<{ select: typeof locationSummarySelect }>;
type ContactRow = Prisma.ContactGetPayload<{ select: typeof contactSummarySelect }>;

export function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    customerType: row.customerType as CustomerType,
  };
}

export function toLocationSummary(row: LocationRow): LocationSummary {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    line1: row.line1,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
  };
}

export function toContactSummary(row: ContactRow) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
  };
}

export function toLineItem(row: {
  id: string;
  serviceId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  total: number;
}): LineItem {
  return {
    id: row.id,
    serviceId: row.serviceId,
    name: row.name,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    unitCost: row.unitCost ?? 0,
    total: row.total,
  };
}

/** Tax rates are stored as basis points; the contract speaks in percent. */
export function taxRateToBps(percent: number): number {
  return Math.round(percent * 100);
}

export function bpsToTaxRate(bps: number): number {
  return bps / 100;
}

export interface PricedLine {
  serviceId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  total: number;
  position: number;
}

export function priceLineItems(
  items: Array<{
    serviceId?: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    unitCost?: number;
  }>,
): { lines: PricedLine[]; subtotal: number } {
  let subtotal = 0;
  const lines = items.map((item, index) => {
    const total = Math.round(item.quantity * item.unitPrice);
    subtotal += total;
    return {
      serviceId: item.serviceId ?? null,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost ?? 0,
      total,
      position: index,
    };
  });
  return { lines, subtotal };
}

/**
 * Nested Prisma creates take a relation connect, not the scalar foreign key.
 * Every line item write path goes through this so price-book links survive.
 */
export function toLineItemCreate(
  lines: readonly PricedLine[],
): Array<{
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  total: number;
  position: number;
  service?: { connect: { id: string } };
}> {
  return lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    unitCost: line.unitCost,
    total: line.total,
    position: line.position,
    ...(line.serviceId ? { service: { connect: { id: line.serviceId } } } : {}),
  }));
}

export function totalsFor(subtotal: number, taxRateBps: number) {
  if (
    !Number.isSafeInteger(subtotal) ||
    !Number.isSafeInteger(taxRateBps) ||
    subtotal < 0 ||
    taxRateBps < 0
  ) {
    throw badRequest("Totals must be whole, non-negative integers");
  }
  const scaled = subtotal * taxRateBps;
  if (!Number.isSafeInteger(scaled)) {
    throw badRequest("Invoice totals exceed the supported range");
  }
  const tax = Math.round(scaled / 10_000);
  const total = subtotal + tax;
  if (!Number.isSafeInteger(tax) || !Number.isSafeInteger(total)) {
    throw badRequest("Invoice totals exceed the supported range");
  }
  return { subtotal, tax, total };
}

const DOCUMENT_PREFIX_BASE = 1000;
const DOCUMENT_RETRIES = 4;

function isRetryableDocumentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (
    "code" in error &&
    (error.code === "P2002" ||
      error.code === "P2010" ||
      error.code === "P2034" ||
      error.code === "P2028")
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /database is locked|write conflict|timed out|socket timeout|transaction already closed/i.test(
    message,
  );
}

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function documentNumberTaken(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  prefix: "JOB" | "EST" | "INV",
  number: string,
): Promise<boolean> {
  const existing =
    prefix === "JOB"
      ? await tx.job.findUnique({
          where: { workspaceId_number: { workspaceId, number } },
          select: { id: true },
        })
      : prefix === "EST"
        ? await tx.estimate.findUnique({
            where: { workspaceId_number: { workspaceId, number } },
            select: { id: true },
          })
        : await tx.invoice.findUnique({
            where: { workspaceId_number: { workspaceId, number } },
            select: { id: true },
          });
  return Boolean(existing);
}

/**
 * Allocates the next human-readable number from the DocumentCounter sequence
 * inside the caller's transaction. The composite primary key makes the upsert
 * atomic, and the counter survives deletes, so numbers are never reused.
 */
export async function allocateNumber(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  prefix: "JOB" | "EST" | "INV",
): Promise<string> {
  let counter = await tx.documentCounter.upsert({
    where: { workspaceId_prefix: { workspaceId, prefix } },
    create: { workspaceId, prefix, value: 1 },
    update: { value: { increment: 1 } },
  });
  let number = `${prefix}-${DOCUMENT_PREFIX_BASE + counter.value}`;
  // Workspaces seeded before the counter existed can already own this number.
  // Step the counter forward instead of failing on the unique constraint.
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (!(await documentNumberTaken(tx, workspaceId, prefix, number))) return number;
    counter = await tx.documentCounter.update({
      where: { workspaceId_prefix: { workspaceId, prefix } },
      data: { value: { increment: 1 } },
    });
    number = `${prefix}-${DOCUMENT_PREFIX_BASE + counter.value}`;
  }
  throw conflict("Could not allocate a document number; please retry");
}

/**
 * Runs a document insert and its number allocation in one transaction. A unique
 * conflict can still surface under contention, so the whole unit is retried a
 * few times before the caller gets a clean conflict response.
 */
async function attemptDocumentWrite<T>(
  workspaceId: string,
  prefix: "JOB" | "EST" | "INV",
  write: (tx: Prisma.TransactionClient, number: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < DOCUMENT_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const number = await allocateNumber(tx, workspaceId, prefix);
          return write(tx, number);
        },
        { maxWait: 20_000, timeout: 20_000 },
      );
    } catch (error) {
      if (!isRetryableDocumentError(error) || attempt === DOCUMENT_RETRIES - 1) throw error;
      await pause(25 * (attempt + 1));
    }
  }
  throw conflict("Could not allocate a document number; please retry");
}

/**
 * SQLite has a single writer and Prisma's interactive transactions queue at the
 * connection level only until the socket timeout. Serialising document writes
 * per workspace in-process keeps concurrent HTTP creates fast and deterministic.
 * Multi-instance deployments should move this to the database sequence instead.
 */
const documentQueues = new Map<string, Promise<void>>();

export async function createWithDocumentNumber<T>(
  workspaceId: string,
  prefix: "JOB" | "EST" | "INV",
  write: (tx: Prisma.TransactionClient, number: string) => Promise<T>,
): Promise<T> {
  const previous = documentQueues.get(workspaceId) ?? Promise.resolve();
  const run = previous.then(
    () => attemptDocumentWrite(workspaceId, prefix, write),
    () => attemptDocumentWrite(workspaceId, prefix, write),
  );
  const queued = run.then(
    () => undefined,
    () => undefined,
  );
  documentQueues.set(workspaceId, queued);
  try {
    return await run;
  } finally {
    if (documentQueues.get(workspaceId) === queued) documentQueues.delete(workspaceId);
  }
}

/**
 * Price-book lines carry a cost, and that cost must flow into the document so
 * margins are right. Explicit unitCost always wins; omitted costs are copied
 * from the referenced service.
 */
export async function applyServiceCosts<
  T extends { serviceId?: string | null; unitCost?: number },
>(workspaceId: string, items: T[]): Promise<T[]> {
  const ids = [
    ...new Set(
      items
        .filter((item) => item.serviceId && item.unitCost === undefined)
        .map((item) => item.serviceId as string),
    ),
  ];
  if (ids.length === 0) return items;
  const services = await prisma.serviceItem.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, cost: true },
  });
  const costs = new Map(services.map((service) => [service.id, service.cost]));
  return items.map((item) =>
    item.unitCost === undefined && item.serviceId
      ? { ...item, unitCost: costs.get(item.serviceId) ?? 0 }
      : item,
  );
}

export async function loadCustomer(workspaceId: string, id: string) {
  const customer = await prisma.company.findFirst({ where: { id, workspaceId } });
  if (!customer) throw notFound("Customer");
  return customer;
}

export async function loadLocation(
  workspaceId: string,
  locationId: string,
  customerId?: string,
) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, workspaceId, ...(customerId ? { customerId } : {}) },
  });
  if (!location) throw notFound("Location");
  return location;
}

export async function loadContact(
  workspaceId: string,
  contactId: string,
  customerId: string,
) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true, companyId: true },
  });
  if (!contact) throw notFound("Contact");
  if (contact.companyId && contact.companyId !== customerId) {
    throw badRequest("That contact belongs to a different customer");
  }
  return contact;
}

export async function loadAssignee(workspaceId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!membership) throw badRequest("Assignee must be a member of this workspace");
  return userId;
}

export async function validateAssociation(
  workspaceId: string,
  customerId: string,
  locationId: string,
  contactId: string | null | undefined,
) {
  await loadCustomer(workspaceId, customerId);
  await loadLocation(workspaceId, locationId, customerId);
  if (contactId) await loadContact(workspaceId, contactId, customerId);
}

/**
 * Line items may reference the price book, so make sure every referenced
 * service belongs to this workspace before it is written.
 */
export async function validateServiceIds(
  workspaceId: string,
  items: Array<{ serviceId?: string | null }>,
) {
  const ids = [...new Set(items.map((item) => item.serviceId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const found = await prisma.serviceItem.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw badRequest("One or more line items reference a service outside this workspace");
  }
}

export function assertRecurrence(value: string | null): RecurrenceFrequency | null {
  return value as RecurrenceFrequency | null;
}

/** Invoice balance and overdue state are derived, never stored. */
export function invoiceState(
  status: InvoiceStatus,
  amount: number,
  amountPaid: number,
  dueAt: Date | null,
  now = new Date(),
) {
  const balance = Math.max(0, amount - amountPaid);
  const overdue = invoiceIsOverdue(status, balance, dueAt, now);
  return { balance, overdue };
}
