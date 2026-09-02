import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOnline,
  retry,
  startHealthMonitor,
  startWakeDetector,
  withTimeout,
} from '../src/watchdog';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('passes through a value that arrives in time', async () => {
    const p = withTimeout(Promise.resolve(7), 1000, 'x');
    await expect(p).resolves.toBe(7);
  });

  it('passes through a rejection', async () => {
    const p = withTimeout(Promise.reject(new Error('boom')), 1000, 'x');
    await expect(p).rejects.toThrow('boom');
  });

  it('rejects with a labelled error once the deadline passes', async () => {
    const p = withTimeout(new Promise(() => {}), 1000, 'history read');
    const assertion = expect(p).rejects.toThrow('history read timed out after 1000ms');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe('retry', () => {
  it('returns the first success without waiting', async () => {
    const task = vi.fn().mockResolvedValue('ok');
    await expect(retry(task, [1000])).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('retries after each delay until the task succeeds', async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok');
    const p = retry(task, [10, 20]);
    await vi.advanceTimersByTimeAsync(30);
    await expect(p).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('rethrows once the delays run out', async () => {
    const task = vi.fn().mockRejectedValue(new Error('nope'));
    const p = retry(task, [10]);
    const assertion = expect(p).rejects.toThrow('nope');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not retry an error shouldRetry rejects', async () => {
    const task = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(retry(task, [10], () => false)).rejects.toThrow('fatal');
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('startWakeDetector', () => {
  const opts = { intervalMs: 1000, thresholdMs: 5000 };

  it('stays quiet while the clock advances with the timer', async () => {
    const onWake = vi.fn();
    let now = 0;
    const detector = startWakeDetector({ ...opts, onWake, now: () => now });
    for (let i = 0; i < 5; i++) {
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(onWake).not.toHaveBeenCalled();
    detector.stop();
  });

  it('fires with the gap when wall-clock time jumps past the threshold', async () => {
    const onWake = vi.fn();
    let now = 0;
    const detector = startWakeDetector({ ...opts, onWake, now: () => now });
    now += 3_600_000; // an hour of sleep, one timer tick of awake time
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWake).toHaveBeenCalledWith(3_600_000);
    detector.stop();
  });

  it('stops firing after stop()', async () => {
    const onWake = vi.fn();
    let now = 0;
    const detector = startWakeDetector({ ...opts, onWake, now: () => now });
    detector.stop();
    now += 3_600_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWake).not.toHaveBeenCalled();
  });
});

describe('startHealthMonitor', () => {
  const opts = { intervalMs: 1000, maxFailures: 3, recoverIntervalMs: 0 };

  it('does not recover while checks pass', async () => {
    const recover = vi.fn().mockResolvedValue(undefined);
    const monitor = startHealthMonitor({
      ...opts,
      check: async () => true,
      recover,
      onGiveUp: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(recover).not.toHaveBeenCalled();
    monitor.stop();
  });

  it('recovers on an unhealthy check', async () => {
    const recover = vi.fn().mockResolvedValue(undefined);
    const monitor = startHealthMonitor({
      ...opts,
      check: async () => false,
      recover,
      onGiveUp: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(recover).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  // The crash loop this guards against: recovery aborts the request whose
  // completion would prove health, so repairing every tick can never converge.
  it('leaves a recovery time to work before trying another', async () => {
    const recover = vi.fn().mockResolvedValue(undefined);
    const monitor = startHealthMonitor({
      ...opts,
      maxFailures: 100,
      recoverIntervalMs: 5000,
      check: async () => false,
      recover,
      onGiveUp: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(recover).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('still counts unhealthy checks that the cooldown skips', async () => {
    const onGiveUp = vi.fn();
    const monitor = startHealthMonitor({
      ...opts,
      recoverIntervalMs: 60_000,
      check: async () => false,
      recover: async () => {},
      onGiveUp,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('gives up after maxFailures consecutive unhealthy checks', async () => {
    const onGiveUp = vi.fn();
    const monitor = startHealthMonitor({
      ...opts,
      check: async () => false,
      recover: async () => {},
      onGiveUp,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(onGiveUp).toHaveBeenCalledTimes(1); // and stops checking afterwards
    monitor.stop();
  });

  it('resets the failure count after a healthy check', async () => {
    const onGiveUp = vi.fn();
    let healthy = false;
    const monitor = startHealthMonitor({
      ...opts,
      check: async () => healthy,
      recover: async () => {},
      onGiveUp,
    });
    await vi.advanceTimersByTimeAsync(2000);
    healthy = true;
    await vi.advanceTimersByTimeAsync(1000);
    healthy = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(onGiveUp).not.toHaveBeenCalled();
    monitor.stop();
  });

  it('does not start a second check while one is still running', async () => {
    const check = vi.fn().mockReturnValue(new Promise(() => {}));
    const monitor = startHealthMonitor({
      ...opts,
      check,
      recover: async () => {},
      onGiveUp: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(1);
    monitor.stop();
  });
});

describe('isOnline', () => {
  it('is true when the host resolves', async () => {
    await expect(isOnline('example.test', async () => ({}))).resolves.toBe(true);
  });

  it('is false when resolution fails', async () => {
    const boom = async () => { throw new Error('EAI_AGAIN'); };
    await expect(isOnline('example.test', boom)).resolves.toBe(false);
  });
});
