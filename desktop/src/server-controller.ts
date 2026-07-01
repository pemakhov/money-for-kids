import { EventEmitter } from 'node:events';

export type ServerState = 'stopped' | 'starting' | 'running' | 'crashed';

export interface ChildHandle {
  kill(signal?: NodeJS.Signals): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

export type SpawnFn = () => ChildHandle;

export interface CrashInfo {
  attempt: number;
  willRestart: boolean;
}

export interface ServerControllerOptions {
  spawn: SpawnFn;
  graceMs?: number;
  backoffMs?: readonly number[];
  stableUptimeMs?: number;
  killTimeoutMs?: number;
}

export interface ServerController {
  start(): void;
  stop(): void;
  getState(): ServerState;
  on(event: 'state', listener: (s: ServerState) => void): void;
  on(event: 'crash', listener: (info: CrashInfo) => void): void;
}

const DEFAULT_BACKOFF = [1000, 5000, 15000, 60000] as const;

export function createServerController(opts: ServerControllerOptions): ServerController {
  const emitter = new EventEmitter();
  const graceMs = opts.graceMs ?? 3000;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  const stableUptimeMs = opts.stableUptimeMs ?? 120000;
  const killTimeoutMs = opts.killTimeoutMs ?? 5000;

  let state: ServerState = 'stopped';
  let child: ChildHandle | null = null;
  let attempts = 0;
  let intentional = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: ServerState): void {
    if (state === next) return;
    state = next;
    emitter.emit('state', state);
  }

  function clear(t: ReturnType<typeof setTimeout> | null): null {
    if (t) clearTimeout(t);
    return null;
  }

  function spawnChild(): void {
    intentional = false;
    setState('starting');
    let c: ChildHandle;
    try {
      c = opts.spawn();
    } catch {
      handleExit();
      return;
    }
    child = c;
    c.on('exit', () => {
      if (child !== c) return;
      handleExit();
    });
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (state === 'starting' && child === c) {
        setState('running');
        stableTimer = setTimeout(() => {
          stableTimer = null;
          if (state === 'running') attempts = 0;
        }, stableUptimeMs);
      }
    }, graceMs);
  }

  function handleExit(): void {
    child = null;
    graceTimer = clear(graceTimer);
    stableTimer = clear(stableTimer);
    killTimer = clear(killTimer);

    if (intentional) {
      intentional = false;
      setState('stopped');
      return;
    }

    attempts += 1;
    if (attempts <= backoff.length) {
      emitter.emit('crash', { attempt: attempts, willRestart: true } satisfies CrashInfo);
      setState('starting');
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        spawnChild();
      }, backoff[attempts - 1]);
    } else {
      emitter.emit('crash', { attempt: attempts, willRestart: false } satisfies CrashInfo);
      attempts = 0;
      setState('crashed');
    }
  }

  function start(): void {
    if (state === 'starting' || state === 'running') return;
    backoffTimer = clear(backoffTimer);
    attempts = 0;
    spawnChild();
  }

  function stop(): void {
    backoffTimer = clear(backoffTimer);
    if (!child) {
      setState('stopped');
      return;
    }
    intentional = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      killTimer = null;
      if (child) child.kill('SIGKILL');
    }, killTimeoutMs);
  }

  return {
    start,
    stop,
    getState: () => state,
    on: (event: 'state' | 'crash', listener: (arg: never) => void) =>
      void emitter.on(event, listener as (...a: unknown[]) => void),
  };
}
