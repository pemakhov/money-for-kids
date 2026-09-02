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
export const HEALTH_MAX_FAILURES = 10;

/**
 * Polls `check`; every unhealthy verdict triggers `recover`, and
 * `maxFailures` consecutive unhealthy verdicts trigger `onGiveUp` (which is
 * expected to end the process so the supervisor can start a clean one).
 */
export function startHealthMonitor(opts: {
  check: () => Promise<boolean>;
  recover: () => Promise<void>;
  onGiveUp: () => void;
  intervalMs?: number;
  maxFailures?: number;
}): Stoppable {
  const intervalMs = opts.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  const maxFailures = opts.maxFailures ?? HEALTH_MAX_FAILURES;

  let failures = 0;
  let busy = false;
  let gaveUp = false;

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
        console.warn(`[watchdog] unhealthy (${failures}/${maxFailures})`);
        if (failures >= maxFailures) {
          gaveUp = true;
          opts.onGiveUp();
          return;
        }
        await opts.recover();
      } catch (err) {
        console.error('[watchdog] health check failed:', err);
      } finally {
        busy = false;
      }
    })();
  }, intervalMs);

  return { stop: () => clearInterval(handle) };
}
