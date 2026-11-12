import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type ExpenseCategory,
  type PaymentMethod,
} from "./enums.js";
import {
  idSchema,
  optionalDate,
  optionalText,
  optionalUrl,
  paginationSchema,
} from "./common.js";
import type { PublicUser } from "./entities.js";
import type { CustomerSummary } from "./service.js";

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customer: CustomerSummary;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  recordedBy: PublicUser | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  category: ExpenseCategory;
  vendor: string | null;
  description: string;
  amount: number;
  incurredAt: string;
  jobId: string | null;
  jobNumber: string | null;
  user: PublicUser | null;
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceRange {
  from: string;
  to: string;
}

export interface FinanceMonth {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface CategoryMargin {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  jobs: number;
}

export interface TechnicianRevenue {
  user: PublicUser;
  jobs: number;
  revenue: number;
  margin: number;
}

export interface CustomerRevenue {
  customer: CustomerSummary;
  revenue: number;
  jobs: number;
  balance: number;
}

export interface FinanceSummary {
  range: FinanceRange;
  currency: string;
  revenue: number;
  collected: number;
  refunds: number;
  invoiced: number;
  outstanding: number;
  overdueAmount: number;
  expenses: number;
  grossProfit: number;
  grossMarginPct: number | null;
  averageTicket: number;
  paymentCount: number;
  monthly: FinanceMonth[];
  expensesByCategory: { category: ExpenseCategory; amount: number }[];
  serviceMargins: CategoryMargin[];
  technicianRevenue: TechnicianRevenue[];
  topCustomers: CustomerRevenue[];
}

export const financeRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const paymentInputSchema = z.object({
  amount: z.coerce.number().int().min(1).max(1_000_000_000),
  method: z.enum(PAYMENT_METHODS).default("CARD"),
  reference: optionalText(120),
  receivedAt: optionalDate,
});

export const paymentListQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  customerId: z.string().trim().max(64).optional(),
  invoiceId: z.string().trim().max(64).optional(),
});

export const expenseInputSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
  vendor: optionalText(120),
  description: z.string().trim().min(1).max(240),
  amount: z.coerce.number().int().min(1).max(1_000_000_000),
  incurredAt: optionalDate,
  jobId: z.preprocess(
    (value) => (value === "" ? null : value),
    idSchema.nullable().optional(),
  ),
  userId: z.preprocess(
    (value) => (value === "" ? null : value),
    idSchema.nullable().optional(),
  ),
  receiptUrl: optionalUrl,
});

export const expensePatchSchema = expenseInputSchema.partial();

export const expenseListQuerySchema = paginationSchema.extend({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  jobId: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export type ExpensePatchInput = z.infer<typeof expensePatchSchema>;
