import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodTypeAny, type output as ZodOutput } from "zod";
import { ERROR_CODES, type PageMeta } from "@meridian/contracts";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, ERROR_CODES.BAD_REQUEST, message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, ERROR_CODES.UNAUTHORIZED, message);

export const forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);

export const notFound = (entity = "Resource") =>
  new AppError(404, ERROR_CODES.NOT_FOUND, `${entity} not found`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, ERROR_CODES.CONFLICT, message, details);

export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
): ZodOutput<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "The request contains invalid fields",
      result.error.flatten(),
    );
  }
  return result.data;
}

export function pageMeta(
  total: number,
  page: number,
  pageSize: number,
): PageMeta {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[] | undefined): string | undefined {
  return tags ? JSON.stringify(tags) : undefined;
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * SQLite's LIKE has no escape character in Prisma's `contains` filter, so
 * backslash escaping would make every wildcard character literal-and-unmatchable.
 * Terms are passed through; `%`/`_` behave as SQL wildcards by design.
 */
export function likeTerm(term: string): string {
  return term;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "The request contains invalid fields",
          details: error.flatten(),
        },
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.status(409).send({
          error: {
            code: ERROR_CODES.CONFLICT,
            message: "That value is already in use. Refresh and try again.",
          },
        });
      }
      if (error.code === "P2003") {
        return reply.status(409).send({
          error: {
            code: ERROR_CODES.CONFLICT,
            message: "That record is still referenced and cannot be changed.",
          },
        });
      }
      if (error.code === "P2025") {
        return reply.status(404).send({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Resource not found" },
        });
      }
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: "Too many requests. Slow down and try again shortly.",
        },
      });
    }
    const statusCode =
      error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "unhandled request error");
      return reply.status(500).send({
        error: {
          code: ERROR_CODES.INTERNAL,
          message:
            "Something went wrong on our side. The request was not completed.",
        },
      });
    }
    return reply.status(statusCode).send({
      error: { code: ERROR_CODES.BAD_REQUEST, message: error.message },
    });
  });
}

export function setNoStore(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store");
}
