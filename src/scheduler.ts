import cron from 'node-cron';

export const MONTHLY_CRON = '0 0 1 * *'; // 00:00 on the 1st of every month

export function scheduleMonthlyBanner(
  timezone: string,
  onFire: () => Promise<void>,
  cronExpr: string = MONTHLY_CRON,
): ReturnType<typeof cron.schedule> {
  return cron.schedule(cronExpr, () => { void onFire(); }, { timezone });
}
