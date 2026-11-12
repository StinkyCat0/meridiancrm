import { z } from "zod";

/**
 * Zod 4 keeps a field's `.default()` when an object schema is `.partial()`,
 * which makes a PATCH that omits a field look like it explicitly sent the
 * default. Strip top-level defaults before making every field optional so
 * `{}` parses to `{}` and update handlers only see keys the caller sent.
 */
type PatchShape<T extends z.ZodRawShape> = {
  [K in keyof T]: z.ZodOptional<z.ZodType<z.output<T[K]>>>;
};

export function patchSchema<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): z.ZodObject<PatchShape<T["shape"]>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, field] of Object.entries(schema.shape) as Array<
    [string, z.ZodTypeAny]
  >) {
    let stripped: z.ZodTypeAny = field;
    while (stripped instanceof z.ZodOptional)
      stripped = stripped.unwrap() as z.ZodTypeAny;
    if (stripped instanceof z.ZodDefault)
      stripped = stripped.removeDefault() as z.ZodTypeAny;
    shape[key] = stripped.optional();
  }
  return z.object(shape as unknown as PatchShape<T["shape"]>);
}

export const idSchema = z.string().min(1).max(64);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
  BAD_REQUEST: "BAD_REQUEST",
} as const;

export const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const optionalText = (max = 2000) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === ""
    );
  } catch {
    return false;
  }
};

export const optionalUrl = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(500)
    .refine(isHttpUrl, "Must be an http(s) URL without credentials")
    .nullable()
    .optional(),
);

export const optionalDate = z.preprocess(
  emptyToNull,
  z.coerce.date().nullable().optional(),
);
