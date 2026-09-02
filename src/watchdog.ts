// Liveness plumbing for an always-on bot running on a laptop that sleeps.
//
// WHY: when the lid closes, macOS freezes the process and kills its TCP
// connections without either peer noticing. On wake the sockets are dead but
// still look open, so an in-flight request hangs until its own timeout fires.
// Everything here exists to notice that quickly and heal it in place.

import { lookup } from 'node:dns/promises';

export interface Stoppable {
  stop(): void;
}

/**
 * Timestamped watchdog line.
 *
 * WHY: these interleave with gramjs's own timestamped logs in one file, and a
 * bare `console.warn` cannot be placed on the timeline of an incident — which
 * is exactly what you need when reading back why the process restarted.
 */
export function watchdogLog(level: 'warn' | 'error', message: string): void {
  console[level](`[${new Date().toISOString()}] [watchdog] ${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with a labelled error if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(handle); resolve(value); },
      (err) => { clearTimeout(handle); reject(err); },
    );
  });
}

/**
 * Runs `task`, retrying after each delay in `delaysMs` while `shouldRetry`
 * holds. `delaysMs.length` retries, so `[]` means a single attempt.
 */
export async function retry<T>(
  task: () => Promise<T>,
  delaysMs: readonly number[],
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (err) {
      if (attempt >= delaysMs.length || !shouldRetry(err)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}

export const WAKE_CHECK_INTERVAL_MS = 5_000;
export const WAKE_GAP_THRESHOLD_MS = 20_000;

/**
 * Fires `onWake` when wall-clock time jumps further than a timer tick can
 * explain — the signature of a system sleep (or a large clock adjustment).
 *
 * WHY: Node has no wake event. macOS freezes the monotonic clock during sleep,
 * so the interval itself fires ~on time after wake while `Date.now()` shows the
 * whole sleep; comparing the two is the detector.
 */
export function startWakeDetector(opts: {
  onWake: (gapMs: number) => void;
  intervalMs?: number;
  thresholdMs?: number;
  now?: () => number;
}): Stoppable {
  const intervalMs = opts.intervalMs ?? WAKE_CHECK_INTERVAL_MS;
  const thresholdMs = opts.thresholdMs ?? WAKE_GAP_THRESHOLD_MS;
  const now = opts.now ?? Date.now;

  let last = now();
  const handle = setInterval(() => {
    const current = now();
    const gapMs = current - last;
    last = current;
    if (gapMs > intervalMs + thresholdMs) opts.onWake(gapMs);
  }, intervalMs);

  return { stop: () => clearInterval(handle) };
}

/**
 * Best-effort "is there any network at all" probe.
 *
 * WHY: it tells a broken process apart from an unplugged one. Restarting
 * cannot bring Wi-Fi back, so an outage must not be allowed to spend the
 * supervisor's restart budget — or fire a crash notification every few
 * minutes while the laptop is off the network.
 */
export async function isOnline(
  hostname = 'api.telegram.org',
  resolve: (host: string) => Promise<unknown> = lookup,
): Promise<boolean> {
  try {
    await resolve(hostname);
    return true;
  } catch {
    return false;
  }
}

export const HEALTH_CHECK_INTERVAL_MS = 30_000;
// Eight minutes of a genuinely wedged process before handing it to the
// supervisor. Generous on purpose: the wake detector already heals the common
// case within seconds, so reaching this count means something unforeseen, and
// a restart that fires too eagerly is worse than the fault it claims to fix.
export const HEALTH_MAX_FAILURES = 16;
// Must clear a whole poll cycle (request timeout + grammy's retry pause + one
// long poll), or a repair lands before the previous one can be shown to work.
export const HEALTH_RECOVER_INTERVAL_MS = 120_000;

/**
 * Polls `check`; an unhealthy verdict triggers `recover` (at most once per
 * `recoverIntervalMs`), and `maxFailures` consecutive unhealthy verdicts
 * trigger `onGiveUp` (which is expected to end the process so the supervisor
 * can start a clean one).
 *
 * WHY the recovery cooldown: healing a connection is disruptive — it tears
 * down requests in flight — so a repair needs quiet time to prove it worked.
 * Repairing on every tick once cost us a crash loop: each repair aborted the
 * very long poll whose completion was the evidence of health, so the verdict
 * could never turn healthy again and the process exited every five minutes.
 * Recovery must always be slower than the recovery it is waiting on.
 */
export function startHealthMonitor(opts: {
  check: () => Promise<boolean>;
  recover: () => Promise<void>;
  onGiveUp: () => void;
  intervalMs?: number;
  maxFailures?: number;
  recoverIntervalMs?: number;
}): Stoppable {
  const intervalMs = opts.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  const maxFailures = opts.maxFailures ?? HEALTH_MAX_FAILURES;
  const recoverIntervalMs = opts.recoverIntervalMs ?? HEALTH_RECOVER_INTERVAL_MS;

  let failures = 0;
  let busy = false;
  let gaveUp = false;
  let lastRecoverAt = -Infinity;

  const handle = setInterval(() => {
    // A check that outlives its interval must not stack up behind itself.
    if (busy || gaveUp) return;
    busy = true;
    void (async () => {
      try {
        if (await opts.check()) {
          failures = 0;
          return;
        }
        failures++;
        watchdogLog('warn', `unhealthy (${failures}/${maxFailures})`);
        if (failures >= maxFailures) {
          gaveUp = true;
          opts.onGiveUp();
          return;
        }
        if (Date.now() - lastRecoverAt < recoverIntervalMs) return;
        lastRecoverAt = Date.now();
        await opts.recover();
      } catch (err) {
        watchdogLog('error', `health check failed: ${String(err)}`);
      } finally {
        busy = false;
      }
    })();
  }, intervalMs);

  return { stop: () => clearInterval(handle) };
}
