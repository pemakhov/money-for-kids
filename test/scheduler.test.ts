import { describe, it, expect, vi, afterEach } from 'vitest';
import cron from 'node-cron';
import { MONTHLY_CRON, scheduleMonthlyBanner } from '../src/scheduler';

afterEach(() => vi.useRealTimers());

describe('scheduler', () => {
  it('uses a valid monthly cron expression', () => {
    expect(cron.validate(MONTHLY_CRON)).toBe(true);
  });

  it('returns a stoppable task', () => {
    const task = scheduleMonthlyBanner('Europe/Kyiv', async () => {});
    expect(typeof task.stop).toBe('function');
    task.stop();
  });

  it('fires on schedule', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T23:59:00Z'));
    const onFire = vi.fn().mockResolvedValue(undefined);
    const task = scheduleMonthlyBanner('UTC', onFire);

    await vi.advanceTimersByTimeAsync(61_000);

    expect(onFire).toHaveBeenCalledTimes(1);
    task.stop();
  });

  it('still fires a slot the host slept through', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T23:59:00Z'));
    const onFire = vi.fn().mockResolvedValue(undefined);
    const task = scheduleMonthlyBanner('UTC', onFire);

    // The lid was closed over midnight: wall-clock time jumps hours while the
    // timers, frozen with the machine, still have their original delay left.
    vi.setSystemTime(new Date('2026-09-01T08:00:00Z'));
    await vi.advanceTimersByTimeAsync(61_000);

    expect(onFire).toHaveBeenCalledTimes(1);
    task.stop();
  });
});
