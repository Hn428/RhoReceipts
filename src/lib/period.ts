/**
 * Reporting periods.
 *
 * Every metric is "per month", and a month is not a fixed span of hours — it
 * depends on a timezone, and its boundaries move with daylight saving. Two
 * services that disagree by one day on where September starts will disagree on
 * MRR forever, so period maths lives here and nowhere else.
 *
 * Rules:
 *
 * - Periods are **half-open**: `[start, end)`. A transaction posted at exactly
 *   midnight on 1 October belongs to October, never to both months and never to
 *   neither.
 * - Boundaries are computed in one declared reporting timezone, not the
 *   server's local zone, which in production is UTC and in development is
 *   whatever the laptop is set to.
 * - Nothing here reads the clock. Callers pass an `asOf` instant — in tests and
 *   against fixtures that is the dataset's anchor, so results never drift.
 *
 * Node 26 has no `Temporal`, so the zone maths is done with `Intl`.
 */

export const DEFAULT_REPORTING_TIME_ZONE =
  process.env.REPORTING_TIME_ZONE ?? "America/New_York";

export interface Period {
  /** Sortable identity, e.g. "2026-09". */
  readonly key: string;
  readonly year: number;
  /** 1-12, not the 0-indexed trap. */
  readonly month: number;
  /** Inclusive lower bound. */
  readonly start: Date;
  /** Exclusive upper bound. */
  readonly end: Date;
  readonly timeZone: string;
}

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodError";
  }
}

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 * Positive east of Greenwich.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    field.year,
    field.month - 1,
    field.day,
    // Some implementations render midnight as hour 24 under hour12:false.
    field.hour % 24,
    field.minute,
    field.second,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess using the offset at the naive instant, then re-check using
 * the offset at the candidate. Without the second pass, times within a few
 * hours of a DST transition land an hour out.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = timeZoneOffsetMs(new Date(naive), timeZone);
  const candidate = naive - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(candidate), timeZone);
  return new Date(
    secondOffset === firstOffset ? candidate : naive - secondOffset,
  );
}

export function monthPeriod(
  year: number,
  month: number,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): Period {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new PeriodError(`Month must be 1-12, received ${month}.`);
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    start: zonedTimeToInstant(year, month, 1, 0, 0, 0, timeZone),
    end: zonedTimeToInstant(nextYear, nextMonth, 1, 0, 0, 0, timeZone),
    timeZone,
  };
}

/** The calendar month that `instant` falls into, in the reporting zone. */
export function periodForInstant(
  instant: Date,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): Period {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }
  return monthPeriod(field.year, field.month, timeZone);
}

export function parsePeriodKey(
  key: string,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): Period {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) {
    throw new PeriodError(`Period key must look like "2026-09", got "${key}".`);
  }
  return monthPeriod(Number(match[1]), Number(match[2]), timeZone);
}

export function addMonths(period: Period, delta: number): Period {
  const zeroBased = period.year * 12 + (period.month - 1) + delta;
  return monthPeriod(
    Math.floor(zeroBased / 12),
    (zeroBased % 12) + 1,
    period.timeZone,
  );
}

/** Half-open containment: start <= instant < end. */
export function contains(period: Period, instant: Date): boolean {
  const t = instant.getTime();
  return t >= period.start.getTime() && t < period.end.getTime();
}

/** A period is complete once the clock has passed its exclusive upper bound. */
export const isComplete = (period: Period, asOf: Date): boolean =>
  asOf.getTime() >= period.end.getTime();

/** Inclusive range of months, oldest first. */
export function monthsBetween(from: Period, to: Period): Period[] {
  const span =
    (to.year * 12 + to.month) - (from.year * 12 + from.month);
  if (span < 0) {
    throw new PeriodError(`Period ${from.key} is after ${to.key}.`);
  }
  return Array.from({ length: span + 1 }, (_, i) => addMonths(from, i));
}

/**
 * The `count` most recent **complete** months as of `asOf`, oldest first.
 *
 * Complete is the point. A trailing-three-month average burn that silently
 * includes a month which is four days old reports a company as burning a third
 * of what it does — the single easiest way to overstate runway.
 */
export function completeTrailingMonths(
  asOf: Date,
  count: number,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): Period[] {
  if (count < 1) throw new PeriodError("count must be at least 1.");
  const current = periodForInstant(asOf, timeZone);
  const lastComplete = isComplete(current, asOf)
    ? current
    : addMonths(current, -1);
  return Array.from({ length: count }, (_, i) =>
    addMonths(lastComplete, i - (count - 1)),
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "September 2026" — formatted from the key, so the zone cannot skew it. */
export const formatPeriod = (period: Period): string =>
  MONTH_LABEL.format(new Date(Date.UTC(period.year, period.month - 1, 1)));

/** The calendar date an instant falls on in `timeZone`, as a UTC-midnight day number. */
function calendarDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }
  return Date.UTC(field.year, field.month - 1, field.day) / 86_400_000;
}

/**
 * Whole calendar days from `from` to `to` in the reporting zone.
 *
 * "18 days overdue" is a statement about dates on a calendar, not a count of
 * 24-hour spans — an invoice due on the 25th is one day overdue on the 26th,
 * whatever the hour.
 */
export function calendarDaysBetween(
  from: Date,
  to: Date,
  timeZone: string = DEFAULT_REPORTING_TIME_ZONE,
): number {
  return calendarDay(to, timeZone) - calendarDay(from, timeZone);
}
