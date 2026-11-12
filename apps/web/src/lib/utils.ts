import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { useEffect, useState } from "react";

export { formatMoney, initials } from "@meridian/contracts";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : parseISO(value);
  return isValid(date) ? date : null;
}

export function formatDate(value: DateInput, pattern = "MMM d, yyyy"): string {
  const date = toDate(value);
  return date ? format(date, pattern) : "—";
}

export function formatDateTime(
  value: DateInput,
  pattern = "MMM d, yyyy · h:mm a",
): string {
  return formatDate(value, pattern);
}

export function relativeTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Money inputs are entered in major units and may use "." or "," as the decimal separator
 * ("24,99", "1.234,56", "1,234.56"); API values are integer cents.
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : parseMajorUnits(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

/** The rightmost separator is decimal; the other one groups thousands. */
function parseMajorUnits(input: string): number {
  const cleaned = input.trim().replace(/[^0-9.,-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    normalized = cleaned.split(group).join("").replace(decimal, ".");
  } else if (lastComma !== -1) {
    const decimals = cleaned.length - lastComma - 1;
    normalized =
      decimals === 3 ? cleaned.split(",").join("") : cleaned.replace(",", ".");
  }
  return Number(normalized);
}

export function fromCents(cents: number | null | undefined): string {
  const amount =
    typeof cents === "number" && Number.isFinite(cents) ? cents / 100 : 0;
  return amount.toFixed(2);
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}
