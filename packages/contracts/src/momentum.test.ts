import { describe, expect, it } from "vitest";
import { computeMomentum, formatMoney, initials } from "./momentum.js";

const now = new Date("2026-06-15T12:00:00.000Z");

const base = {
  stageKind: "OPEN" as const,
  stageAgeDays: 5,
  stageTargetDays: 14,
  activityCount30d: 6,
  lastActivityDaysAgo: 1,
  expectedCloseDate: new Date("2026-06-20T12:00:00.000Z"),
  now,
};

describe("computeMomentum", () => {
  it("scores an engaged, recent, on-time deal as hot", () => {
    const momentum = computeMomentum(base);
    expect(momentum.score).toBe(100);
    expect(momentum.band).toBe("hot");
    for (const item of momentum.breakdown)
      expect(item.points).toBeLessThanOrEqual(item.max);
  });

  it("drops to cold when there is no activity and the close date is overdue", () => {
    const momentum = computeMomentum({
      ...base,
      activityCount30d: 0,
      lastActivityDaysAgo: null,
      stageAgeDays: 90,
      expectedCloseDate: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(momentum.band).toBe("cold");
    expect(momentum.score).toBeLessThan(40);
  });

  it("keeps breakdown points summing to the score", () => {
    const momentum = computeMomentum({
      ...base,
      activityCount30d: 2,
      lastActivityDaysAgo: 10,
      stageAgeDays: 20,
      expectedCloseDate: null,
    });
    const sum = momentum.breakdown.reduce(
      (total, item) => total + item.points,
      0,
    );
    expect(momentum.score).toBe(sum);
    expect(momentum.band).toBe("warm");
  });

  it("short-circuits closed deals", () => {
    expect(computeMomentum({ ...base, stageKind: "WON" }).score).toBe(100);
    expect(computeMomentum({ ...base, stageKind: "LOST" }).score).toBe(0);
  });
});

describe("formatters", () => {
  it("formats cents as whole currency", () => {
    expect(formatMoney(4_800_00, "USD")).toBe("$4,800");
  });

  it("derives initials", () => {
    expect(initials("Avery Meridian")).toBe("AM");
  });
});
