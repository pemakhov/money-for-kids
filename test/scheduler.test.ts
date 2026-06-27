import { describe, it, expect } from 'vitest';
import cron from 'node-cron';
import { MONTHLY_CRON, scheduleMonthlyBanner } from '../src/scheduler';

describe('scheduler', () => {
  it('uses a valid monthly cron expression', () => {
    expect(cron.validate(MONTHLY_CRON)).toBe(true);
  });
  it('returns a stoppable task', () => {
    const task = scheduleMonthlyBanner('Europe/Kyiv', async () => {});
    expect(typeof task.stop).toBe('function');
    task.stop();
  });
});
