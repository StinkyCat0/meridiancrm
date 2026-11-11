import type { InvoiceStatus } from "./enums.js";

/** Invoice transitions that preserve the payment ledger. */
export const INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["DRAFT", "SENT", "VOID"],
  SENT: ["SENT", "PARTIAL", "PAID", "VOID"],
  PARTIAL: ["PARTIAL", "PAID", "VOID"],
  PAID: ["PAID"],
  VOID: ["VOID"],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Status is a pure function of the money once an invoice leaves DRAFT. A
 * zero-total invoice must be voided or explicitly sent; it can never be
 * "paid" by a zero payment.
 */
export function deriveInvoiceStatus(
  amount: number,
  amountPaid: number,
  current: InvoiceStatus,
): InvoiceStatus {
  if (current === "VOID") return "VOID";
  if (current === "DRAFT") {
    if (amountPaid > 0) return amountPaid >= amount && amount > 0 ? "PAID" : "PARTIAL";
    return "DRAFT";
  }
  if (amount > 0 && amountPaid >= amount) return "PAID";
  if (amountPaid > 0) return "PARTIAL";
  return "SENT";
}

export function invoiceIsOverdue(
  status: InvoiceStatus,
  balance: number,
  dueAt: Date | null,
  now: Date,
): boolean {
  if (status === "DRAFT" || status === "VOID" || status === "PAID") return false;
  return balance > 0 && dueAt !== null && dueAt.getTime() < now.getTime();
}
