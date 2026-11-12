import { z } from "zod";
import { idSchema, optionalDate, optionalText, patchSchema } from "./common.js";
import {
  CUSTOMER_TYPES,
  ESTIMATE_STATUSES,
  INVOICE_STATUSES,
  JOB_PRIORITIES,
  JOB_STATUSES,
  RECURRENCE_FREQUENCIES,
  SERVICE_UNITS,
  type CustomerType,
  type EstimateStatus,
  type InvoiceStatus,
  type JobPriority,
  type JobStatus,
  type RecurrenceFrequency,
  type ServiceUnit,
} from "./enums.js";
import type { PublicUser } from "./entities.js";

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  customerType: CustomerType;
}

export interface LocationSummary {
  id: string;
  customerId: string;
  label: string;
  line1: string;
  city: string;
  state: string | null;
  postalCode: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ServiceSummary {
  id: string;
  name: string;
  unit: ServiceUnit;
  price: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  unit: ServiceUnit;
  durationMinutes: number;
  price: number;
  cost: number;
  taxable: boolean;
  archived: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  customer: CustomerSummary;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  accessNotes: string | null;
  gateCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  archived: boolean;
  openJobCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LineItem {
  id: string;
  serviceId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  total: number;
}

export interface Job {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  source: string | null;
  customer: CustomerSummary;
  location: LocationSummary;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
  assignee: PublicUser | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  durationMinutes: number;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  deposit: number;
  notes: string | null;
  cancelReason: string | null;
  rating: number | null;
  ratingNote: string | null;
  recurrence: RecurrenceFrequency | null;
  recurrenceUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Estimate {
  id: string;
  number: string;
  title: string;
  status: EstimateStatus;
  customer: CustomerSummary;
  location: LocationSummary;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  jobId: string | null;
  jobNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  title: string;
  status: InvoiceStatus;
  overdue: boolean;
  customer: CustomerSummary;
  location: LocationSummary | null;
  jobId: string | null;
  jobNumber: string | null;
  amount: number;
  amountPaid: number;
  balance: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsSummary {
  date: string;
  jobsToday: number;
  jobsTodayCompleted: number;
  jobsUnscheduled: number;
  jobsUnassigned: number;
  revenueToday: number;
  revenueWeek: number;
  bookedWeek: number;
  outstanding: number;
  overdueInvoices: number;
  activeCustomers: number;
  recurringJobs: number;
  pipelineValue: number;
  openEstimates: number;
  openEstimateValue: number;
  today: Job[];
  upcoming: Job[];
  currency: string;
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

const nullableId = z.preprocess(
  (value) => (value === "" ? null : value),
  idSchema.nullable().optional(),
);

export const locationInputSchema = z.object({
  customerId: idSchema,
  label: z.string().trim().min(1).max(60).default("Main"),
  line1: z.string().trim().min(1).max(200),
  line2: optionalText(120),
  city: z.string().trim().min(1).max(120),
  state: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  accessNotes: optionalText(2000),
  gateCode: optionalText(60),
  contactName: optionalText(120),
  contactPhone: optionalText(40),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  isPrimary: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const locationPatchSchema = patchSchema(locationInputSchema).omit({
  customerId: true,
});

export const serviceInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: optionalText(80),
  description: optionalText(2000),
  unit: z.enum(SERVICE_UNITS).default("VISIT"),
  durationMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  price: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  cost: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  taxable: z.boolean().default(true),
  archived: z.boolean().optional(),
});

export const servicePatchSchema = patchSchema(serviceInputSchema);

export const lineItemInputSchema = z.object({
  serviceId: nullableId,
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().min(0.01).max(10_000).default(1),
  unitPrice: z.coerce.number().int().min(0).max(1_000_000_000),
  unitCost: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

export type LineItemInput = z.infer<typeof lineItemInputSchema>;

const taxRateSchema = z.coerce.number().min(0).max(50).default(0);

export const jobInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  customerId: idSchema,
  locationId: idSchema,
  contactId: nullableId,
  assigneeId: nullableId,
  status: z.enum(JOB_STATUSES).default("UNSCHEDULED"),
  priority: z.enum(JOB_PRIORITIES).default("NORMAL"),
  source: optionalText(80),
  scheduledStart: optionalDate,
  scheduledEnd: optionalDate,
  durationMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  taxRate: taxRateSchema,
  deposit: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  notes: optionalText(5000),
  recurrence: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(RECURRENCE_FREQUENCIES).nullable().optional(),
  ),
  recurrenceUntil: optionalDate,
  lineItems: z.array(lineItemInputSchema).max(50).default([]),
});

export const jobPatchSchema = patchSchema(jobInputSchema).extend({
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  ratingNote: optionalText(500),
  cancelReason: optionalText(240),
});
export const jobStatusSchema = z.object({
  status: z.enum(JOB_STATUSES),
  cancelReason: optionalText(240),
});
export const jobDuplicateSchema = z.object({
  scheduledStart: optionalDate,
});

export const estimateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  customerId: idSchema,
  locationId: idSchema,
  contactId: nullableId,
  status: z.enum(ESTIMATE_STATUSES).default("DRAFT"),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  taxRate: taxRateSchema,
  notes: optionalText(5000),
  lineItems: z.array(lineItemInputSchema).max(50).default([]),
});

export const estimatePatchSchema = patchSchema(estimateInputSchema);
export const estimateStatusSchema = z.object({
  status: z.enum(ESTIMATE_STATUSES),
});
export const estimateConvertSchema = z.object({
  scheduledStart: optionalDate,
  assigneeId: nullableId,
});

export const invoiceInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    jobId: nullableId,
    customerId: nullableId,
    locationId: nullableId,
    status: z.enum(INVOICE_STATUSES).default("DRAFT"),
    amount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    issuedAt: optionalDate,
    dueAt: optionalDate,
    notes: optionalText(2000),
  })
  .refine((value) => Boolean(value.jobId ?? value.customerId), {
    message: "An invoice needs a job or a customer",
    path: ["customerId"],
  });

export const invoicePatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  amount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  amountPaid: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  issuedAt: optionalDate,
  dueAt: optionalDate,
  paidAt: optionalDate,
  notes: optionalText(2000),
});

export const invoicePaymentSchema = z.object({
  amountPaid: z.coerce.number().int().min(0).max(1_000_000_000),
});

export const opsQuerySchema = z.object({
  date: z.string().trim().max(40).optional(),
});

/* -------------------------------------------------------------------------- */
/* Presentation helpers (shared by API and every client)                       */
/* -------------------------------------------------------------------------- */

export type CustomerTypeValue = CustomerType;
export type JobStatusValue = JobStatus;
export type JobPriorityValue = JobPriority;
export type EstimateStatusValue = EstimateStatus;
export type InvoiceStatusValue = InvoiceStatus;
export type RecurrenceValue = RecurrenceFrequency;
export type ServiceUnitValue = ServiceUnit;
