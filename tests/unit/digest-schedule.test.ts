import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  lastBoundaryBefore,
  zonedParts,
  zonedTimeToInstant,
  type DigestSchedule,
} from "@/lib/digest/schedule";

const BERLIN: DigestSchedule = { day: "sunday", hour: 18, timeZone: "Europe/Berlin" };

/**
 * The digest boundary in real local time.
 *
 * The tests that matter are the two changeover weekends: 18:00 has to stay
 * 18:00 in Berlin, and the week containing the change is still a week.
 */
describe("finding the boundary", () => {
  it("takes the most recent scheduled moment before now", () => {
    // Wednesday 2026-09-09, 09:00 UTC.
    const boundary = lastBoundaryBefore(new Date("2026-09-09T09:00:00Z"), BERLIN);
    // Sunday 2026-09-06 18:00 Berlin is 16:00 UTC (CEST, +2).
    expect(boundary.toISOString()).toBe("2026-09-06T16:00:00.000Z");
  });

  it("does not jump forward to a boundary that has not happened yet", () => {
    // Sunday 2026-09-06 at 17:00 Berlin — an hour before the boundary.
    const boundary = lastBoundaryBefore(new Date("2026-09-06T15:00:00Z"), BERLIN);
    expect(boundary.toISOString()).toBe("2026-08-30T16:00:00.000Z");
  });

  it("uses the boundary itself when now is exactly on it", () => {
    const exactly = new Date("2026-09-06T16:00:00Z");
    expect(lastBoundaryBefore(exactly, BERLIN).getTime()).toBe(exactly.getTime());
  });

  /** Berlin goes to +01:00 on the last Sunday of October. */
  it("keeps 18:00 local across the autumn changeover", () => {
    const boundary = lastBoundaryBefore(new Date("2026-10-26T09:00:00Z"), BERLIN);
    expect(boundary.toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(zonedParts(boundary, "Europe/Berlin").hour).toBe(18);
  });

  /** And to +02:00 on the last Sunday of March. */
  it("keeps 18:00 local across the spring changeover", () => {
    const boundary = lastBoundaryBefore(new Date("2026-03-30T09:00:00Z"), BERLIN);
    expect(boundary.toISOString()).toBe("2026-03-29T16:00:00.000Z");
    expect(zonedParts(boundary, "Europe/Berlin").hour).toBe(18);
  });

  it("works for a timezone with no changeover at all", () => {
    const schedule: DigestSchedule = {
      day: "friday",
      hour: 8,
      timeZone: "Asia/Kolkata",
    };
    const boundary = lastBoundaryBefore(new Date("2026-09-09T09:00:00Z"), schedule);
    // 08:00 IST is 02:30 UTC.
    expect(boundary.toISOString()).toBe("2026-09-04T02:30:00.000Z");
  });
});

describe("the period", () => {
  it("covers the seven days before the boundary", () => {
    const period = currentPeriod(new Date("2026-09-09T09:00:00Z"), BERLIN);
    expect(period.end.toISOString()).toBe("2026-09-06T16:00:00.000Z");
    expect(period.start.toISOString()).toBe("2026-08-30T16:00:00.000Z");
  });

  /**
   * The week containing the changeover is 169 hours of real time, and both
   * ends still read 18:00 locally. That is the point of doing this in the
   * timezone rather than subtracting 7 × 24 hours.
   */
  it("stays a local week when the clocks change inside it", () => {
    const period = currentPeriod(new Date("2026-10-26T09:00:00Z"), BERLIN);
    expect(zonedParts(period.start, "Europe/Berlin").hour).toBe(18);
    expect(zonedParts(period.end, "Europe/Berlin").hour).toBe(18);
    const hours = (period.end.getTime() - period.start.getTime()) / 3_600_000;
    expect(hours).toBe(169);
  });
});

describe("wall clock to instant", () => {
  it("resolves a normal time", () => {
    const instant = zonedTimeToInstant(
      { year: 2026, month: 1, day: 15, hour: 9 },
      "Europe/Berlin",
    );
    expect(instant.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  /** 02:30 does not exist on the spring-forward morning; it must not throw. */
  it("gives a usable answer for a time the clock skips", () => {
    const instant = zonedTimeToInstant(
      { year: 2026, month: 3, day: 29, hour: 2 },
      "Europe/Berlin",
    );
    expect(Number.isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });
});
