/**
 * Minimal RFC 4180-style CSV writer used by the export endpoints.
 *
 * Spreadsheet formula injection is prevented by prefixing user-controlled
 * strings that begin with `=`, `+`, `-`, `@`, a tab or a carriage return with
 * a single quote. Raw numbers and booleans are emitted verbatim; formatted
 * strings, including negative money amounts, receive the same guard.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\r\n]/;

function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const guarded =
    typeof value === "string" && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

/** Serializes rows to CRLF-delimited CSV, including a header row. */
export function serializeCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Integer cents to major units with two decimals and no currency symbol. */
export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}
