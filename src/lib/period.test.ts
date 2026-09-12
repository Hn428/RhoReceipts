import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPORTING_TIME_ZONE,
  PeriodError,
  addMonths,
  completeTrailingMonths,
  contains,
  formatPeriod,
  isComplete,
  monthPeriod,
  monthsBetween,
  parsePeriodKey,
  periodForInstant,
  timeZoneOffsetMs,
  zonedTimeToInstant,
} from "./period";

const NY = "America/New_York";
const HOUR = 3_600_000;

describe("timezone offsets", () => {
  it("tracks daylight saving", () => {
    expect(timeZoneOffsetMs(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-5 * HOUR);
    expect(timeZoneOffsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * HOUR);
  });

  it("handles zones ahead of UTC", () => {
    expect(timeZoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "Asia/Tokyo")).toBe(9 * HOUR);
  });

  it("resolves midnight without the hour-24 trap", () => {
    const instant = zonedTimeToInstant(2026, 6, 15, 0, 0, 0, NY);
    expect(instant.toISOString()).toBe("2026-06-15T04:00:00.000Z");
  });
});

describe("month boundaries", () => {
  it("starts a winter month at the right UTC instant", () => {
    // Midnight in New York on 1 January is 05:00 UTC (EST).
    expect(monthPeriod(2026, 1, NY).start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("starts a summer month an hour earlier in UTC", () => {
    // Midnight on 1 July is 04:00 UTC (EDT) — an hour off if DST is ignored.
    expect(monthPeriod(2026, 7, NY).start.toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });

  it("spans a DST transition without gaining or losing an hour of coverage", () => {
    // US DST begins 8 March 2026, so March is 23 hours shorter than 31 days.
    const march = monthPeriod(2026, 3, NY);
    const hours = (march.end.getTime() - march.start.getTime()) / HOUR;
    expect(hours).toBe(31 * 24 - 1);
  });

  it("rolls December into the following January", () => {
    const december = monthPeriod(2025, 12, NY);
    expect(december.end.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("rejects an out-of-range month", () => {
    expect(() => monthPeriod(2026, 13, NY)).toThrow(PeriodError);
    expect(() => monthPeriod(2026, 0, NY)).toThrow(PeriodError);
  });
});

describe("half-open containment", () => {
  const september = monthPeriod(2026, 9, NY);

  it("includes its own start instant", () => {
    expect(contains(september, september.start)).toBe(true);
  });

  it("excludes its end instant", () => {
    expect(contains(september, september.end)).toBe(false);
  });

  it("hands the boundary instant to exactly one month", () => {
    const october = monthPeriod(2026, 10, NY);
    const boundary = september.end;
    expect(contains(september, boundary)).toBe(false);
    expect(contains(october, boundary)).toBe(true);
  });

  it("puts late-night end-of-month activity in the right month", () => {
    // 23:30 on 30 September in New York is 1 October in UTC. Naive UTC
    // bucketing would file this transaction under October.
    const instant = new Date("2026-10-01T03:30:00Z");
    expect(contains(september, instant)).toBe(true);
    expect(periodForInstant(instant, NY).key).toBe("2026-09");
  });
});

describe("completeness", () => {
  const anchor = new Date("2026-09-12T00:00:00Z");

  it("knows a month in progress is not complete", () => {
    expect(isComplete(monthPeriod(2026, 9, NY), anchor)).toBe(false);
  });

  it("knows a finished month is complete", () => {
    expect(isComplete(monthPeriod(2026, 8, NY), anchor)).toBe(true);
  });

  it("excludes the partial current month from trailing windows", () => {
    // The critical case: including a 12-day-old September would understate
    // burn and overstate runway.
    const months = completeTrailingMonths(anchor, 3, NY);
    expect(months.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("includes the current month once it has actually ended", () => {
    const months = completeTrailingMonths(new Date("2026-10-01T05:00:00Z"), 3, NY);
    expect(months.map((m) => m.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("rejects a nonsensical window", () => {
    expect(() => completeTrailingMonths(anchor, 0, NY)).toThrow(PeriodError);
  });
});

describe("arithmetic and keys", () => {
  it("adds months across a year boundary", () => {
    expect(addMonths(monthPeriod(2025, 11, NY), 3).key).toBe("2026-02");
  });

  it("subtracts months across a year boundary", () => {
    expect(addMonths(monthPeriod(2026, 2, NY), -3).key).toBe("2025-11");
  });

  it("enumerates an inclusive range oldest first", () => {
    const range = monthsBetween(monthPeriod(2026, 1, NY), monthPeriod(2026, 4, NY));
    expect(range.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("rejects a reversed range", () => {
    expect(() => monthsBetween(monthPeriod(2026, 4, NY), monthPeriod(2026, 1, NY))).toThrow(PeriodError);
  });

  it("round-trips a period key", () => {
    expect(parsePeriodKey("2026-09", NY).month).toBe(9);
    expect(() => parsePeriodKey("2026-9", NY)).toThrow(PeriodError);
  });

  it("labels a period without zone skew", () => {
    expect(formatPeriod(monthPeriod(2026, 9, NY))).toBe("September 2026");
    expect(formatPeriod(monthPeriod(2026, 1, NY))).toBe("January 2026");
  });

  it("defaults to the configured reporting zone", () => {
    expect(DEFAULT_REPORTING_TIME_ZONE).toBe(NY);
  });
});

describe("fixture anchor", () => {
  it("places the dataset's last transaction in September 2026", () => {
    expect(periodForInstant(new Date("2026-09-11T16:38:00Z"), NY).key).toBe("2026-09");
  });
});
