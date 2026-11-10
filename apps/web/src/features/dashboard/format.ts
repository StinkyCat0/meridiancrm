import { format, isValid, parseISO } from "date-fns";
import { formatMoney } from "../../lib/utils";

export function monthLabel(month: string | undefined): string {
  if (!month) return "—";
  const date = parseISO(`${month}-01`);
  return isValid(date) ? format(date, "MMM") : month;
}

export function monthYearLabel(month: string | undefined): string {
  if (!month) return "—";
  const date = parseISO(`${month}-01`);
  return isValid(date) ? format(date, "MMM yyyy") : month;
}

/** Axis-friendly money; full precision stays in tooltips and cards. */
export function compactMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(cents / 100);
  } catch {
    return formatMoney(cents, currency);
  }
}
