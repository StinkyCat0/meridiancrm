import { describe, expect, it } from "vitest";
import { buildMessageDraft } from "./drafts.js";
import { deriveInvoiceStatus, invoiceIsOverdue } from "./invoice-rules.js";
import {
  estimateDriveMinutes,
  haversineMeters,
  optimizeRoute,
} from "./route.js";
import { churnRiskScore, noShowRiskScore, upsellScore } from "./scoring.js";

describe("route optimization", () => {
  it("measures distance and orders points from the depot", () => {
    const start = { latitude: 30.2672, longitude: -97.7431 };
    const points = [
      { id: "far", latitude: 30.45, longitude: -97.9 },
      { id: "near", latitude: 30.27, longitude: -97.75 },
      { id: "mid", latitude: 30.35, longitude: -97.82 },
    ];
    expect(haversineMeters(start, points[1]!)).toBeLessThan(1_000);
    const route = optimizeRoute(start, points);
    expect(route.ordered[0]?.id).toBe("near");
    expect(route.totalDistanceMeters).toBeGreaterThan(0);
    expect(route.ordered).toHaveLength(3);
    expect(estimateDriveMinutes(route.totalDistanceMeters, 3)).toBeGreaterThan(
      0,
    );
  });

  it("returns an empty route without points", () => {
    const route = optimizeRoute({ latitude: 0, longitude: 0 }, []);
    expect(route.ordered).toEqual([]);
    expect(route.totalDistanceMeters).toBe(0);
  });
});

describe("message drafts", () => {
  const base = {
    customerName: "Avery Stone",
    contactName: "Avery Stone",
    businessName: "Cedar & Co.",
    businessTypeLabel: "Window cleaning",
    channel: "SMS" as const,
    tone: "WARM" as const,
    appointmentLabel: "Tue, Nov 18 at 9:00 AM",
    jobNumber: "JOB-1012",
    serviceName: "Exterior window clean",
    amountLabel: "$240.00",
    serviceArea: "Austin, TX",
  };

  it("uses appointment and balance context in reminders and payment drafts", () => {
    const reminder = buildMessageDraft({ ...base, intent: "REMINDER" });
    expect(reminder.body).toContain("Tue, Nov 18");
    expect(reminder.subject).toBeNull();
    const payment = buildMessageDraft({
      ...base,
      channel: "EMAIL",
      intent: "PAYMENT",
    });
    expect(payment.subject).toContain("$240.00");
    expect(payment.body).toContain("$240.00");
    expect(payment.rationale).toContain("local template engine");
  });

  it("never returns an empty body for any intent", () => {
    for (const intent of [
      "GENERAL",
      "REMINDER",
      "FOLLOW_UP",
      "QUOTE",
      "PAYMENT",
      "REVIEW",
      "WINBACK",
      "RESCHEDULE",
    ] as const) {
      const draft = buildMessageDraft({ ...base, intent });
      expect(draft.body.length).toBeGreaterThan(20);
    }
  });
});

describe("invoice rules", () => {
  it("derives status from money and protects drafts and zero totals", () => {
    expect(deriveInvoiceStatus(100, 0, "SENT")).toBe("SENT");
    expect(deriveInvoiceStatus(100, 40, "SENT")).toBe("PARTIAL");
    expect(deriveInvoiceStatus(100, 100, "SENT")).toBe("PAID");
    expect(deriveInvoiceStatus(0, 0, "SENT")).toBe("SENT");
    expect(deriveInvoiceStatus(100, 100, "DRAFT")).toBe("PAID");
    expect(deriveInvoiceStatus(100, 0, "VOID")).toBe("VOID");
  });

  it("only marks open balances past due as overdue", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(
      invoiceIsOverdue("SENT", 100, new Date("2026-11-01T12:00:00Z"), now),
    ).toBe(true);
    expect(
      invoiceIsOverdue("SENT", 0, new Date("2026-11-01T12:00:00Z"), now),
    ).toBe(false);
    expect(
      invoiceIsOverdue("PAID", 100, new Date("2026-11-01T12:00:00Z"), now),
    ).toBe(false);
    expect(
      invoiceIsOverdue("DRAFT", 100, new Date("2026-11-01T12:00:00Z"), now),
    ).toBe(false);
  });
});

describe("explainable scores", () => {
  it("keeps active customers out of churn risk", () => {
    expect(
      churnRiskScore({
        daysSinceLastJob: 200,
        completedJobsLastYear: 6,
        hasUpcoming: true,
        openBalance: 0,
      }),
    ).toBe(0);
    expect(
      churnRiskScore({
        daysSinceLastJob: 120,
        completedJobsLastYear: 6,
        hasUpcoming: false,
        openBalance: 500,
      }),
    ).toBeGreaterThan(50);
  });

  it("raises no-show risk for repeat no-shows and long lead times", () => {
    expect(
      noShowRiskScore({
        priorNoShows: 0,
        priorCancellations: 0,
        leadTimeHours: 24,
        hasConfirmation: true,
      }),
    ).toBe(0);
    expect(
      noShowRiskScore({
        priorNoShows: 2,
        priorCancellations: 1,
        leadTimeHours: 200,
        hasConfirmation: false,
      }),
    ).toBeGreaterThan(60);
  });

  it("suppresses upsells the customer already bought", () => {
    expect(
      upsellScore({
        daysSinceService: 60,
        price: 12_000,
        marginPct: 55,
        alreadyPurchased: true,
        customerLifetimeJobs: 5,
      }),
    ).toBe(0);
    expect(
      upsellScore({
        daysSinceService: 60,
        price: 12_000,
        marginPct: 55,
        alreadyPurchased: false,
        customerLifetimeJobs: 5,
      }),
    ).toBeGreaterThan(70);
  });
});
