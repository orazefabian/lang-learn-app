/**
 * When the week ends.
 *
 * The digest is weekly and lands on a configured weekday and hour in a
 * configured timezone, which means real local time: 18:00 stays 18:00 across
 * the March and October changeovers rather than drifting by an hour. Doing
 * that with Intl rather than a date library keeps the dependency list short,
 * and the arithmetic is small enough to test directly.
 */

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DigestSchedule = {
  day: Weekday;
  hour: number;
  timeZone: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading of an instant in a timezone. */
export function zonedParts(instant: Date, timeZone: string): Parts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday").toLowerCase() as Weekday,
  };
}

/** The timezone's offset from UTC at a given instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant at which a wall-clock time occurs in a timezone.
 *
 * Two passes: the first offset is a guess taken at the wrong instant, the
 * second corrects it when the guess landed on the other side of a DST change.
 */
export function zonedTimeToInstant(
  wall: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
  const firstGuess = asIfUtc - offsetAt(new Date(asIfUtc), timeZone);
  const corrected = asIfUtc - offsetAt(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/**
 * The most recent scheduled boundary at or before `now`.
 *
 * Walking back a day at a time rather than doing modular arithmetic on the
 * weekday: it is eight iterations at most, and it stays correct when a day in
 * the timezone is 23 or 25 hours long.
 */
export function lastBoundaryBefore(now: Date, schedule: DigestSchedule): Date {
  for (let back = 0; back <= 8; back += 1) {
    const probe = new Date(now.getTime() - back * DAY_MS);
    const parts = zonedParts(probe, schedule.timeZone);
    if (parts.weekday !== schedule.day) continue;

    const candidate = zonedTimeToInstant(
      { year: parts.year, month: parts.month, day: parts.day, hour: schedule.hour },
      schedule.timeZone,
    );
    if (candidate.getTime() <= now.getTime()) return candidate;
  }

  // Unreachable for any real timezone: some weekday matches within eight days.
  throw new Error(`could not find a digest boundary for ${schedule.day} in ${schedule.timeZone}`);
}

export type DigestPeriod = { start: Date; end: Date };

/** The week the digest covers: the seven days ending at the last boundary. */
export function periodEndingAt(boundary: Date, schedule: DigestSchedule): DigestPeriod {
  const parts = zonedParts(new Date(boundary.getTime() - 7 * DAY_MS), schedule.timeZone);
  const start = zonedTimeToInstant(
    { year: parts.year, month: parts.month, day: parts.day, hour: schedule.hour },
    schedule.timeZone,
  );
  return { start, end: boundary };
}

export function currentPeriod(now: Date, schedule: DigestSchedule): DigestPeriod {
  return periodEndingAt(lastBoundaryBefore(now, schedule), schedule);
}
