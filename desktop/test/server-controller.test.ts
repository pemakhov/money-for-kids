import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServerController, type ChildHandle, type ServerState, type CrashInfo } from '../src/server-controller';

function makeFakeChild() {
  const em = new EventEmitter();
  const kill = vi.fn();
  const handle: ChildHandle = {
    kill,
    on: (event, listener) => { em.on(event, listener as (...a: unknown[]) => void); },
  };
  return {
    handle,
    kill,
    exit: (code: number | null = 1) => em.emit('exit', code, null),
    error: (err: Error = new Error('spawn failed')) => em.emit('error', err),
  };
}

const OPTS = { graceMs: 3000, backoffMs: [1000, 5000, 15000, 60000], stableUptimeMs: 120000, killTimeoutMs: 5000 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createServerController', () => {
  it('start() goes starting then running after the grace period', () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => child.handle);
    const c = createServerController({ spawn, ...OPTS });
    const states: ServerState[] = [];
    c.on('state', (s) => states.push(s));

    c.start();
    expect(c.getState()).toBe('starting');
    vi.advanceTimersByTime(3000);
    expect(c.getState()).toBe('running');
    expect(states).toEqual(['starting', 'running']);
  });

  it('exit before grace crashes, emits willRestart, and restarts after backoff', () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawn = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const c = createServerController({ spawn, ...OPTS });
    const crashes: CrashInfo[] = [];
    c.on('crash', (i) => crashes.push(i));

    c.start();
    first.exit(1);
    expect(crashes).toEqual([{ attempt: 1, willRestart: true }]);
    expect(c.getState()).toBe('starting');
    expect(spawn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000); // backoff[0]
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3000); // grace on second child
    expect(c.getState()).toBe('running');
  });

  it('gives up after the 5th consecutive failure', () => {
    const children = Array.from({ length: 5 }, () => makeFakeChild());
    let i = 0;
    const spawn = vi.fn(() => children[i++].handle);
    const c = createServerController({ spawn, ...OPTS });
    const crashes: CrashInfo[] = [];
    c.on('crash', (info) => crashes.push(info));

    c.start();
    // fail 4 times, each followed by its backoff-driven respawn
    const delays = [0, 1000, 5000, 15000];
    for (let n = 0; n < 4; n++) {
      children[n].exit(1);
      vi.advanceTimersByTime(delays[n + 1] ?? 60000);
    }
    // 5th child fails -> give up
    children[4].exit(1);

    expect(crashes[4]).toEqual({ attempt: 5, willRestart: false });
    expect(c.getState()).toBe('crashed');
    expect(spawn).toHaveBeenCalledTimes(5);
  });

  it('intentional stop terminates without restarting', () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => child.handle);
    const c = createServerController({ spawn, ...OPTS });

    c.start();
    vi.advanceTimersByTime(3000);
    expect(c.getState()).toBe('running');

    c.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.exit(0);
    expect(c.getState()).toBe('stopped');

    vi.advanceTimersByTime(120000);
    expect(spawn).toHaveBeenCalledTimes(1); // no restart
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => child.handle);
    const c = createServerController({ spawn, ...OPTS });

    c.start();
    vi.advanceTimersByTime(3000);
    c.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('resets the attempt counter after stable uptime', () => {
    const children = Array.from({ length: 4 }, () => makeFakeChild());
    let i = 0;
    const spawn = vi.fn(() => children[i++].handle);
    const c = createServerController({ spawn, ...OPTS });
    const crashes: CrashInfo[] = [];
    c.on('crash', (info) => crashes.push(info));

    c.start();
    children[0].exit(1);                 // attempt 1
    vi.advanceTimersByTime(1000);        // respawn child 1
    children[1].exit(1);                 // attempt 2
    vi.advanceTimersByTime(5000);        // respawn child 2 -> reaches running
    vi.advanceTimersByTime(3000);        // grace -> running
    expect(c.getState()).toBe('running');
    vi.advanceTimersByTime(120000);      // stable uptime -> attempts reset

    children[2].exit(1);                 // crash again, counter restarted
    expect(crashes.at(-1)).toEqual({ attempt: 1, willRestart: true });
  });

  it("child 'error' before grace is treated as a crash that schedules a backoff restart", () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawn = vi.fn().mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle);
    const c = createServerController({ spawn, ...OPTS });
    const crashes: CrashInfo[] = [];
    c.on('crash', (i) => crashes.push(i));

    c.start();
    first.error(); // emit 'error' before grace period
    expect(crashes).toEqual([{ attempt: 1, willRestart: true }]);
    expect(c.getState()).toBe('starting');
    expect(spawn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000); // backoff[0] -> second spawn
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3000); // grace on second child -> running
    expect(c.getState()).toBe('running');
  });

  it('double stop does not fire SIGKILL more than once', () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => child.handle);
    const c = createServerController({ spawn, ...OPTS });

    c.start();
    vi.advanceTimersByTime(3000); // grace period -> running

    c.stop(); // SIGTERM + kill timer T1
    c.stop(); // SIGTERM again; fix: clears T1, sets T2

    // child is still alive (ignoring SIGTERM), advance past killTimeoutMs
    vi.advanceTimersByTime(OPTS.killTimeoutMs);

    // SIGKILL must be sent exactly once (not twice from two leaked timers)
    expect(child.kill.mock.calls.filter(([s]) => s === 'SIGKILL')).toHaveLength(1);
    expect(spawn).toHaveBeenCalledTimes(1); // no unexpected respawn
  });
});
