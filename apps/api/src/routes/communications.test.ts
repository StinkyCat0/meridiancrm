import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

let app: FastifyInstance;
let account: TestAccount;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  account = await registerAccount(app);
});

function headersFor(target: TestAccount = account) {
  return authHeaders(target);
}

async function createCustomer(
  name = "Cedar & Co",
  target: TestAccount = account,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: headersFor(target),
    payload: {
      name,
      customerType: "RESIDENTIAL",
      email: `${name.toLowerCase().replace(/[^a-z]+/g, "")}@example.com`,
      phone: "503-555-0100",
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createContact(companyId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/contacts",
    headers: headersFor(),
    payload: {
      firstName: "Dana",
      lastName: "Reed",
      email: "dana@example.com",
      phone: "503-555-0111",
      companyId,
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createLocation(customerId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/locations",
    headers: headersFor(),
    payload: {
      customerId,
      label: "Main",
      line1: "412 Alder Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      isPrimary: true,
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createJob(
  customerId: string,
  locationId: string,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: headersFor(),
    payload: {
      title: "Deep clean",
      customerId,
      locationId,
      scheduledStart: "2026-02-10T16:00:00.000Z",
      lineItems: [{ name: "Deep clean", quantity: 1, unitPrice: 12000 }],
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createInvoice(customerId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: headersFor(),
    payload: {
      title: "Deep clean invoice",
      customerId,
      status: "SENT",
      amount: 9000,
      issuedAt: "2026-01-05T10:00:00.000Z",
      dueAt: "2026-01-19T10:00:00.000Z",
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createEstimate(
  customerId: string,
  locationId: string,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/estimates",
    headers: headersFor(),
    payload: {
      title: "Deep clean quote",
      customerId,
      locationId,
      status: "SENT",
      issuedAt: "2026-01-04T10:00:00.000Z",
      lineItems: [{ name: "Deep clean", quantity: 1, unitPrice: 9000 }],
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function logCommunication(payload: Record<string, unknown>, target: TestAccount = account) {
  return app.inject({
    method: "POST",
    url: "/api/v1/communications",
    headers: headersFor(target),
    payload,
  });
}

async function listCommunications(query = "", target: TestAccount = account) {
  return app.inject({
    method: "GET",
    url: `/api/v1/communications${query}`,
    headers: headersFor(target),
  });
}

describe("communications inbox", () => {
  it("logs messages, infers the customer, serializes relations and paginates deterministically", async () => {
    const customer = await createCustomer();
    const contact = await createContact(customer.id);
    const location = await createLocation(customer.id);
    const job = await createJob(customer.id, location.id);

    const sms = await logCommunication({
      channel: "SMS",
      direction: "INBOUND",
      body: "Can you come Tuesday?",
      contactId: contact.id,
      occurredAt: "2026-01-01T09:00:00.000Z",
    });
    expect(sms.statusCode).toBe(201);
    const smsBody = sms.json();
    expect(smsBody.status).toBe("RECEIVED");
    expect(smsBody.provider).toBe("log");
    expect(smsBody.customer).toMatchObject({ id: customer.id, name: customer.name });
    expect(smsBody.contact).toMatchObject({ id: contact.id, firstName: "Dana", phone: contact.phone });
    expect(smsBody.user.id).toBe(account.userId);
    expect(smsBody.readAt).toBeNull();

    const call = await logCommunication({
      channel: "CALL",
      direction: "OUTBOUND",
      customerId: customer.id,
      jobId: job.id,
      body: "Called about the scheduled visit",
      occurredAt: "2026-01-02T09:00:00.000Z",
    });
    expect(call.statusCode).toBe(201);
    expect(call.json().status).toBe("LOGGED");
    expect(call.json().jobNumber).toBe(job.number);

    const email = await logCommunication({
      channel: "EMAIL",
      direction: "OUTBOUND",
      customerId: customer.id,
      subject: "Your visit is confirmed",
      body: "See you soon.",
      occurredAt: "2026-01-03T09:00:00.000Z",
    });
    expect(email.statusCode).toBe(201);
    expect(email.json().status).toBe("SENT");
    expect(email.json().subject).toBe("Your visit is confirmed");

    const list = await listCommunications(`?customerId=${customer.id}`);
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.meta).toMatchObject({ total: 3, page: 1, pageSize: 25, totalPages: 1 });
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      email.json().id,
      call.json().id,
      sms.json().id,
    ]);

    const paged = await listCommunications(`?customerId=${customer.id}&page=2&pageSize=2`);
    expect(paged.json().data).toHaveLength(1);
    expect(paged.json().data[0].id).toBe(sms.json().id);

    const unread = await listCommunications(`?customerId=${customer.id}&unread=true`);
    expect(unread.json().data.map((row: { id: string }) => row.id)).toEqual([sms.json().id]);

    const filtered = await listCommunications(
      `?customerId=${customer.id}&channel=EMAIL&direction=OUTBOUND&q=confirmed`,
    );
    expect(filtered.json().data.map((row: { id: string }) => row.id)).toEqual([email.json().id]);

    const read = await app.inject({
      method: "PATCH",
      url: `/api/v1/communications/${sms.json().id}`,
      headers: headersFor(),
      payload: { readAt: "2026-01-04T09:00:00.000Z", sentiment: "POSITIVE" },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().sentiment).toBe("POSITIVE");
    expect(read.json().readAt).toBe("2026-01-04T09:00:00.000Z");

    const afterRead = await listCommunications(`?customerId=${customer.id}&unread=true`);
    expect(afterRead.json().data).toHaveLength(0);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/communications/${sms.json().id}`,
      headers: headersFor(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(sms.json().id);
  });

  it("rejects messages without a link and links that cross customers", async () => {
    const customer = await createCustomer("Alder House");
    const other = await createCustomer("Birch Barn");
    const otherContact = await createContact(other.id, { firstName: "Milo", lastName: "Hart" });
    const location = await createLocation(customer.id);
    const job = await createJob(customer.id, location.id);

    const empty = await logCommunication({ channel: "SMS", direction: "OUTBOUND", body: "Hi" });
    expect(empty.statusCode).toBe(400);

    const mismatched = await logCommunication({
      channel: "SMS",
      customerId: customer.id,
      contactId: otherContact.id,
    });
    expect(mismatched.statusCode).toBe(400);

    const inferredFromJob = await logCommunication({ channel: "CALL", jobId: job.id });
    expect(inferredFromJob.statusCode).toBe(201);
    expect(inferredFromJob.json().customer.id).toBe(customer.id);
    expect(inferredFromJob.json().jobId).toBe(job.id);
  });

  it("scopes reads, writes and drafts to the workspace", async () => {
    const customer = await createCustomer();
    const created = await logCommunication({
      channel: "SMS",
      customerId: customer.id,
      body: "Private thread",
    });
    expect(created.statusCode).toBe(201);

    const stranger = await registerAccount(app);

    const list = await listCommunications("", stranger);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(0);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/communications/${created.json().id}`,
      headers: headersFor(stranger),
    });
    expect(detail.statusCode).toBe(404);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/communications/${created.json().id}`,
      headers: headersFor(stranger),
      payload: { sentiment: "NEGATIVE" },
    });
    expect(patch.statusCode).toBe(404);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/communications/${created.json().id}`,
      headers: headersFor(stranger),
    });
    expect(remove.statusCode).toBe(404);

    const crossTenantCreate = await logCommunication(
      { channel: "SMS", customerId: customer.id, body: "Intruder" },
      stranger,
    );
    expect(crossTenantCreate.statusCode).toBe(404);

    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/communications/draft",
      headers: headersFor(stranger),
      payload: { customerId: customer.id, channel: "SMS", intent: "FOLLOW_UP" },
    });
    expect(draft.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/communications/${created.json().id}`,
      headers: headersFor(),
    });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({
      method: "GET",
      url: `/api/v1/communications/${created.json().id}`,
      headers: headersFor(),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("groups inbox threads by customer with counts, channels and search", async () => {
    const alder = await createCustomer("Alder House");
    const birch = await createCustomer("Birch Barn");

    await logCommunication({
      channel: "SMS",
      direction: "INBOUND",
      customerId: alder.id,
      body: "First",
      occurredAt: "2026-01-01T09:00:00.000Z",
    });
    const latestAlder = await logCommunication({
      channel: "EMAIL",
      direction: "OUTBOUND",
      customerId: alder.id,
      subject: "Second",
      body: "Second",
      occurredAt: "2026-01-02T09:00:00.000Z",
    });
    const latestBirch = await logCommunication({
      channel: "CALL",
      direction: "INBOUND",
      customerId: birch.id,
      body: "Voicemail",
      occurredAt: "2026-01-03T09:00:00.000Z",
    });

    const threads = await app.inject({
      method: "GET",
      url: "/api/v1/communications/threads",
      headers: headersFor(),
    });
    expect(threads.statusCode).toBe(200);
    const rows = threads.json();
    expect(rows).toHaveLength(2);
    expect(rows[0].customer.id).toBe(birch.id);
    expect(rows[0].lastMessage.id).toBe(latestBirch.json().id);
    expect(rows[0].messageCount).toBe(1);
    expect(rows[0].unreadCount).toBe(1);
    expect(rows[0].channels).toEqual(["CALL"]);

    expect(rows[1].customer.id).toBe(alder.id);
    expect(rows[1].lastMessage.id).toBe(latestAlder.json().id);
    expect(rows[1].messageCount).toBe(2);
    expect(rows[1].unreadCount).toBe(1);
    expect(rows[1].channels).toEqual(["SMS", "EMAIL"]);

    const searched = await app.inject({
      method: "GET",
      url: "/api/v1/communications/threads?q=Alder",
      headers: headersFor(),
    });
    expect(searched.json()).toHaveLength(1);
    expect(searched.json()[0].customer.id).toBe(alder.id);

    const limited = await app.inject({
      method: "GET",
      url: "/api/v1/communications/threads?limit=1",
      headers: headersFor(),
    });
    expect(limited.json()).toHaveLength(1);
    expect(limited.json()[0].customer.id).toBe(birch.id);
  });

  it("reports inbox stats including open task follow-ups", async () => {
    const customer = await createCustomer();

    await logCommunication({
      channel: "CALL",
      direction: "INBOUND",
      customerId: customer.id,
      occurredAt: new Date().toISOString(),
    });
    await logCommunication({
      channel: "SMS",
      direction: "OUTBOUND",
      customerId: customer.id,
      body: "On our way",
      occurredAt: new Date().toISOString(),
    });
    await logCommunication({
      channel: "EMAIL",
      direction: "OUTBOUND",
      customerId: customer.id,
      subject: "Quote",
      occurredAt: "2025-12-01T09:00:00.000Z",
    });

    const activity = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: headersFor(),
      payload: { type: "TASK", title: "Follow up on quote", companyId: customer.id },
    });
    expect(activity.statusCode).toBe(201);

    const stats = await app.inject({
      method: "GET",
      url: "/api/v1/communications/stats",
      headers: headersFor(),
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      total: 3,
      calls: 1,
      texts: 1,
      emails: 1,
      inbound: 1,
      outbound: 2,
      unread: 1,
      callsToday: 1,
      textsToday: 1,
      followUpsOpen: 1,
    });
  });

  it("builds a local draft from the customer, job, appointment and open balance", async () => {
    const customer = await createCustomer("Alder House");
    const contact = await createContact(customer.id);
    const location = await createLocation(customer.id);
    const job = await createJob(customer.id, location.id);
    await createInvoice(customer.id);

    const paymentDraft = await app.inject({
      method: "POST",
      url: "/api/v1/communications/draft",
      headers: headersFor(),
      payload: {
        customerId: customer.id,
        channel: "EMAIL",
        intent: "PAYMENT",
        jobId: job.id,
        tone: "PROFESSIONAL",
      },
    });
    expect(paymentDraft.statusCode).toBe(200);
    const payment = paymentDraft.json();
    expect(payment.channel).toBe("EMAIL");
    expect(payment.intent).toBe("PAYMENT");
    expect(payment.tone).toBe("PROFESSIONAL");
    expect(payment.subject).toContain("Invoice reminder");
    expect(payment.subject).toContain("$90");
    expect(payment.body).toContain("Dana");
    expect(payment.body).toContain("$90");
    expect(payment.body).toContain("Best regards");
    expect(payment.rationale).toContain("No customer data left the server");

    const reminder = await app.inject({
      method: "POST",
      url: "/api/v1/communications/draft",
      headers: headersFor(),
      payload: {
        customerId: customer.id,
        channel: "SMS",
        intent: "REMINDER",
        jobId: job.id,
        tone: "WARM",
      },
    });
    expect(reminder.statusCode).toBe(200);
    expect(reminder.json().subject).toBeNull();
    expect(reminder.json().body).toContain("Deep clean");
    expect(reminder.json().body).toContain(job.number);
    expect(reminder.json().body).toContain("Feb");
    expect(reminder.json().body).toContain(contact.firstName);
  });
});

describe("customer timeline", () => {
  it("merges activity, messages, jobs, estimates, invoices and payments newest first", async () => {
    const customer = await createCustomer("Cedar & Co");
    const location = await createLocation(customer.id);

    const activity = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: headersFor(),
      payload: {
        type: "NOTE",
        title: "Left a gate code note",
        companyId: customer.id,
        completedAt: "2026-01-02T10:00:00.000Z",
      },
    });
    expect(activity.statusCode).toBe(201);

    const communication = await logCommunication({
      channel: "SMS",
      direction: "OUTBOUND",
      customerId: customer.id,
      body: "Confirmed for Tuesday",
      occurredAt: "2026-01-03T10:00:00.000Z",
    });
    expect(communication.statusCode).toBe(201);

    const job = await createJob(customer.id, location.id, {
      scheduledStart: "2026-01-01T15:00:00.000Z",
    });
    const estimate = await createEstimate(customer.id, location.id);
    const invoice = await createInvoice(customer.id, {
      status: "PARTIAL",
      amount: 12000,
    });
    const payment = await prisma.payment.create({
      data: {
        workspaceId: account.workspaceId,
        invoiceId: invoice.id,
        amount: 5000,
        method: "CARD",
        receivedAt: new Date("2026-01-06T10:00:00.000Z"),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${customer.id}/timeline`,
      headers: headersFor(),
    });
    expect(response.statusCode).toBe(200);
    const timeline = response.json();

    expect(timeline.customer).toMatchObject({ id: customer.id, name: customer.name });
    expect(timeline.items.map((item: { kind: string }) => item.kind)).toEqual([
      "payment",
      "invoice",
      "estimate",
      "communication",
      "activity",
      "job",
    ]);
    expect(timeline.counts).toEqual({
      activity: 1,
      communication: 1,
      job: 1,
      estimate: 1,
      invoice: 1,
      payment: 1,
    });

    const paymentItem = timeline.items[0];
    expect(paymentItem.entityId).toBe(payment.id);
    expect(paymentItem.amount).toBe(5000);
    expect(paymentItem.href).toBe(`/app/invoices?invoice=${invoice.id}`);

    const invoiceItem = timeline.items[1];
    expect(invoiceItem.entityId).toBe(invoice.id);
    expect(invoiceItem.href).toBe(`/app/invoices?invoice=${invoice.id}`);
    expect(invoiceItem.amount).toBe(12000);

    const estimateItem = timeline.items[2];
    expect(estimateItem.entityId).toBe(estimate.id);
    expect(estimateItem.href).toBe(`/app/estimates?estimate=${estimate.id}`);

    const communicationItem = timeline.items[3];
    expect(communicationItem.entityId).toBe(communication.json().id);
    expect(communicationItem.href).toBe(`/app/inbox?customer=${customer.id}`);
    expect(communicationItem.channel).toBe("SMS");

    const jobItem = timeline.items[5];
    expect(jobItem.entityId).toBe(job.id);
    expect(jobItem.href).toBe(`/app/schedule?job=${job.id}`);

    const limited = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${customer.id}/timeline?limit=2`,
      headers: headersFor(),
    });
    expect(limited.json().items.map((item: { kind: string }) => item.kind)).toEqual([
      "payment",
      "invoice",
    ]);
    expect(limited.json().counts.invoice).toBe(1);

    const capped = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${customer.id}/timeline?limit=500`,
      headers: headersFor(),
    });
    expect(capped.statusCode).toBe(400);
  });

  it("does not expose another workspace's customer timeline", async () => {
    const customer = await createCustomer();
    const stranger = await registerAccount(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${customer.id}/timeline`,
      headers: headersFor(stranger),
    });
    expect(response.statusCode).toBe(404);
  });
});
