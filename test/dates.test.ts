import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { bucketFromUtc, currentBucket, previousBucket } from '../src/dates';

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
