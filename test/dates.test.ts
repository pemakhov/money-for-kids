import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { bucketFromUtc, currentBucket, previousBucket, bucketFromUnix, previousBucketFromUnix } from '../src/dates';

describe('month buckets', () => {
  const jan = DateTime.fromISO('2026-01-15T12:00:00Z', { zone: 'utc' });

  it('currentBucket reads year/month in the timezone', () => {
    expect(currentBucket('Europe/Kyiv', jan)).toEqual({ year: 2026, month: 1 });
  });
  it('previousBucket wraps across the year boundary', () => {
    expect(previousBucket('Europe/Kyiv', jan)).toEqual({ year: 2025, month: 12 });
  });
  it('bucketFromUtc respects the timezone offset at month edges', () => {
    // 30 June 22:30 UTC is 1 July 01:30 in Kyiv (summer, +3)
    expect(bucketFromUtc('2026-06-30T22:30:00Z', 'Europe/Kyiv')).toEqual({ year: 2026, month: 7 });
    // same instant in UTC bucket stays in June
    expect(bucketFromUtc('2026-06-30T22:30:00Z', 'UTC')).toEqual({ year: 2026, month: 6 });
  });
});

describe('bucketFromUnix', () => {
  // 10 June 2026 12:00 UTC
  const JUNE = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);
  it('buckets a unix timestamp into its month in the given zone', () => {
    expect(bucketFromUnix(JUNE, 'Europe/Kyiv')).toEqual({ year: 2026, month: 6 });
  });
  it('previousBucketFromUnix returns the month before the message date', () => {
    expect(previousBucketFromUnix(JUNE, 'Europe/Kyiv')).toEqual({ year: 2026, month: 5 });
  });
  it('previousBucketFromUnix rolls the year at January', () => {
    const JAN = Math.floor(Date.UTC(2026, 0, 15, 12, 0, 0) / 1000);
    expect(previousBucketFromUnix(JAN, 'Europe/Kyiv')).toEqual({ year: 2025, month: 12 });
  });
});
