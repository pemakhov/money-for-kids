import { DateTime } from 'luxon';

export interface MonthBucket {
  year: number;
  month: number;
}

function toBucket(dt: DateTime): MonthBucket {
  return { year: dt.year, month: dt.month };
}

export function bucketFromUtc(utcISO: string, timezone: string): MonthBucket {
  return toBucket(DateTime.fromISO(utcISO, { zone: 'utc' }).setZone(timezone));
}

export function currentBucket(timezone: string, now: DateTime = DateTime.utc()): MonthBucket {
  return toBucket(now.setZone(timezone));
}

export function previousBucket(timezone: string, now: DateTime = DateTime.utc()): MonthBucket {
  return toBucket(now.setZone(timezone).minus({ months: 1 }));
}

export function nowUtcISO(): string {
  return DateTime.utc().toISO()!;
}
