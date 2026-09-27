import { describe, expect, it } from "vitest";
import { anchoredMonthlyPeriod } from "./quota-period";

describe("anchoredMonthlyPeriod (Section 8 'Period')", () => {
  it("returns the anchor itself as periodStart when now is exactly the anchor", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    const { periodStart, periodEnd } = anchoredMonthlyPeriod(anchor, anchor);
    expect(periodStart.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-02-15T10:00:00.000Z");
  });

  it("advances to the next monthly window once `now` passes periodEnd", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    const now = new Date("2026-02-20T00:00:00Z");
    const { periodStart, periodEnd } = anchoredMonthlyPeriod(anchor, now);
    expect(periodStart.toISOString()).toBe("2026-02-15T10:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-03-15T10:00:00.000Z");
  });

  it("stays in the same window one second before it ends", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    const now = new Date("2026-02-15T09:59:59Z");
    const { periodStart } = anchoredMonthlyPeriod(anchor, now);
    expect(periodStart.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("handles a month-end anchor (e.g. Jan 31) rolling into shorter months", () => {
    const anchor = new Date("2026-01-31T00:00:00Z");
    // JS Date normalizes Jan 31 + 1 month to Mar 3 (Feb has 28 days in 2026) — the function must
    // still find a consistent, monotonically increasing window for `now` regardless.
    const now = new Date("2026-02-10T00:00:00Z");
    const { periodStart, periodEnd } = anchoredMonthlyPeriod(anchor, now);
    expect(periodStart.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(periodEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  it("handles an org that has existed for many months", () => {
    const anchor = new Date("2024-03-01T00:00:00Z");
    const now = new Date("2026-09-27T00:00:00Z");
    const { periodStart, periodEnd } = anchoredMonthlyPeriod(anchor, now);
    expect(periodStart.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(periodEnd.getTime()).toBeGreaterThan(now.getTime());
    // exactly one month apart
    const diffDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(27);
    expect(diffDays).toBeLessThan(32);
  });
});
