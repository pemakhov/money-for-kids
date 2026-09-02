import cron from 'node-cron';

export const MONTHLY_CRON = '0 0 1 * *'; // 00:00 on the 1st of every month

// WHY: node-cron drops a slot it wakes up late for — its default tolerance is
// one second. The host is a laptop that is asleep at midnight on the 1st, so
// with the default the banner would simply never post. A week is late enough
// to cover any realistic sleep and still far short of the month between slots,
// which is what keeps a run from being counted twice.
export const MISSED_EXECUTION_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;

export function scheduleMonthlyBanner(
  timezone: string,
  onFire: () => Promise<void>,
  cronExpr: string = MONTHLY_CRON,
): ReturnType<typeof cron.schedule> {
  return cron.schedule(cronExpr, () => { void onFire(); }, {
    timezone,
    missedExecutionTolerance: MISSED_EXECUTION_TOLERANCE_MS,
    noOverlap: true,
  });
}
