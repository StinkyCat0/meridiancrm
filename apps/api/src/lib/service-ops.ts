import type { Prisma } from "@prisma/client";
import type {
  CustomerSummary,
  CustomerType,
  InvoiceStatus,
  LineItem,
  LocationSummary,
  RecurrenceFrequency,
} from "@meridian/contracts";
import { badRequest, notFound } from "./http.js";
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
  const tax = Math.round((subtotal * taxRateBps) / 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

const PREFIX_BASE = 1001;

/**
 * Human-readable document numbers. The count-based allocation is safe for the
 * single-process deployment this MVP targets; the existence check keeps numbers
 * stable when rows are deleted. A multi-writer deployment should move this to a
 * dedicated sequence table.
 */
export async function allocateNumber(
  prefix: "JOB" | "EST" | "INV",
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let offset = 0; offset < 500; offset += 1) {
    const candidate = `${prefix}-${PREFIX_BASE + offset}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
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
  const overdue =
    status !== "PAID" && status !== "VOID" && dueAt !== null && dueAt.getTime() < now.getTime();
  return { balance, overdue };
}
