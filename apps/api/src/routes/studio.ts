import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ERROR_CODES,
  studioAccountListQuerySchema,
  studioAccountPageSchema,
  studioAccountUpdateResponseSchema,
  studioAccountUpdateSchema,
  studioBillingPageSchema,
  studioBillingQuerySchema,
  studioChatRoomListSchema,
  studioChatRoomResponseSchema,
  studioChatRoomsQuerySchema,
  studioDemoListSchema,
  studioInquiryListQuerySchema,
  studioInquiryPageSchema,
  studioInquiryUpdateResponseSchema,
  studioInquiryUpdateSchema,
  studioMessageCreateSchema,
  studioMessageListSchema,
  studioMessageResponseSchema,
  studioMessagesQuerySchema,
  studioOverviewSchema,
  studioRoomCreateSchema,
  studioRoomUpdateSchema,
  studioSettingsSchema,
} from "@meridian/contracts";
import { audit } from "../lib/audit.js";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { AppError, parseOrThrow } from "../lib/http.js";
import {
  WebsiteStudioError,
  websiteStudioRequest,
} from "../lib/website-studio.js";

const BAD_GATEWAY = "BAD_GATEWAY";
const RATE_LIMIT = { max: 120, timeWindow: "1 minute" } as const;
const idParamsSchema = z.object({ id: z.string().min(1).max(128) });

async function requireAdmin(request: FastifyRequest): Promise<void> {
  await authenticate(request);
  await requireRole(request, "ADMIN");
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/** Maps website failures to the documented BFF contract: 503 unconfigured, 502 otherwise. */
function studioFailure(error: unknown): never {
  if (error instanceof WebsiteStudioError) {
    if (error.reason === "unconfigured") {
      throw new AppError(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Website Studio is not configured",
      );
    }
    // The website's own validation/conflict responses (e.g. 409 when the last
    // active admin would be deactivated) are the caller's to fix, not a gateway
    // failure. A website 401 means the CRM's service token is wrong, so it
    // stays a 502 below.
    if (error.status === 400) {
      throw new AppError(
        400,
        ERROR_CODES.BAD_REQUEST,
        "The website rejected this Studio request",
      );
    }
    if (error.status === 403) {
      throw new AppError(
        403,
        ERROR_CODES.FORBIDDEN,
        "The website denied this Studio request",
      );
    }
    if (error.status === 404) {
      throw new AppError(
        404,
        ERROR_CODES.NOT_FOUND,
        "Studio resource not found",
      );
    }
    if (error.status === 409) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        "The website rejected this Studio change",
      );
    }
    throw new AppError(
      502,
      BAD_GATEWAY,
      "The website Studio API is unavailable",
    );
  }
  throw error;
}

export async function studioRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/studio/overview",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website Studio overview counts",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      try {
        const data = parseOrThrow(
          studioOverviewSchema,
          await websiteStudioRequest("/overview"),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/accounts",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website accounts",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const query = parseOrThrow(studioAccountListQuerySchema, request.query);
      try {
        const data = parseOrThrow(
          studioAccountPageSchema,
          await websiteStudioRequest(`/accounts${queryString(query)}`),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.patch(
    "/studio/accounts/:id",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Update website account flags",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const body = parseOrThrow(studioAccountUpdateSchema, request.body);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioAccountUpdateResponseSchema,
          await websiteStudioRequest(`/accounts/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body,
          }),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.account_updated",
          entityType: "studio_account",
          entityId: id,
          metadata: { fields: Object.keys(body) },
        });
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/inquiries",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website contact inquiries",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const query = parseOrThrow(studioInquiryListQuerySchema, request.query);
      try {
        const data = parseOrThrow(
          studioInquiryPageSchema,
          await websiteStudioRequest(`/inquiries${queryString(query)}`),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.patch(
    "/studio/inquiries/:id",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Update a website inquiry status",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const body = parseOrThrow(studioInquiryUpdateSchema, request.body);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioInquiryUpdateResponseSchema,
          await websiteStudioRequest(`/inquiries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body,
          }),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.inquiry_updated",
          entityType: "studio_inquiry",
          entityId: id,
          metadata: { status: body.status },
        });
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/chat/rooms",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website chat rooms",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const query = parseOrThrow(studioChatRoomsQuerySchema, request.query);
      try {
        const data = parseOrThrow(
          studioChatRoomListSchema,
          await websiteStudioRequest(`/chat/rooms${queryString(query)}`),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.post(
    "/studio/chat/rooms",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Create a website chat room",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(studioRoomCreateSchema, request.body);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioChatRoomResponseSchema,
          await websiteStudioRequest("/chat/rooms", {
            method: "POST",
            body,
          }),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.chat_room_created",
          entityType: "studio_chat_room",
          entityId: data.room.id,
          metadata: { name: data.room.name },
        });
        return reply.status(201).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.patch(
    "/studio/chat/rooms/:id",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Update a website chat room",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const body = parseOrThrow(studioRoomUpdateSchema, request.body);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioChatRoomResponseSchema,
          await websiteStudioRequest(`/chat/rooms/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body,
          }),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.chat_room_updated",
          entityType: "studio_chat_room",
          entityId: id,
          metadata: { fields: Object.keys(body) },
        });
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.delete(
    "/studio/chat/rooms/:id",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Archive a website chat room",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioChatRoomResponseSchema,
          await websiteStudioRequest(`/chat/rooms/${encodeURIComponent(id)}`, {
            method: "DELETE",
          }),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.chat_room_archived",
          entityType: "studio_chat_room",
          entityId: id,
        });
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/chat/rooms/:id/messages",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website chat room messages",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const query = parseOrThrow(studioMessagesQuerySchema, request.query);
      try {
        const data = parseOrThrow(
          studioMessageListSchema,
          await websiteStudioRequest(
            `/chat/rooms/${encodeURIComponent(id)}/messages${queryString(query)}`,
          ),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.post(
    "/studio/chat/rooms/:id/messages",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Post a message as the signed-in CRM admin",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const body = parseOrThrow(studioMessageCreateSchema, request.body);
      const auth = getAuth(request);
      try {
        const data = parseOrThrow(
          studioMessageResponseSchema,
          await websiteStudioRequest(
            `/chat/rooms/${encodeURIComponent(id)}/messages`,
            {
              method: "POST",
              // The browser never chooses the author.
              body: { ...body, authorEmail: auth.email },
            },
          ),
        );
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "studio.chat_message_posted",
          entityType: "studio_chat_message",
          entityId: data.message.id,
          metadata: { roomId: id },
        });
        return reply.status(201).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/billing",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website subscription billing overview",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const query = parseOrThrow(studioBillingQuerySchema, request.query);
      try {
        const data = parseOrThrow(
          studioBillingPageSchema,
          await websiteStudioRequest(`/billing${queryString(query)}`),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/demos",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website demo traffic",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      try {
        const data = parseOrThrow(
          studioDemoListSchema,
          await websiteStudioRequest("/demos"),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );

  app.get(
    "/studio/settings",
    {
      preHandler: requireAdmin,
      config: { rateLimit: RATE_LIMIT },
      schema: {
        tags: ["studio"],
        summary: "Website integration settings",
        security: [{ bearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      try {
        const data = parseOrThrow(
          studioSettingsSchema,
          await websiteStudioRequest("/settings"),
        );
        return reply.status(200).send(data);
      } catch (error) {
        studioFailure(error);
      }
    },
  );
}
