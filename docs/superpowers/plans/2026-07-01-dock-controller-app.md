# macOS Dock Controller App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a window-less Electron macOS app that pins in the dock, supervises the Telegram ledger server (`tsx src/index.ts`) as a child process, reflects its state in the dock-icon color, toggles on click (confirming before a stop), auto-restarts on crash, and launches at login.

**Architecture:** A self-contained `desktop/` Electron project with its own `package.json`. A pure, dependency-injected `server-controller` module owns a `stopped→starting→running`/`crashed` state machine and the child process; it is the unit-tested core. Thin Electron glue (`main.ts`) wires dock-icon/menu/dialog/notifications/login-item to the controller. The controller points at the existing repo checkout and spawns Node by absolute path (GUI apps don't inherit shell `PATH`), invoking tsx's CLI directly.

**Tech Stack:** Electron, TypeScript (ES2022, ESM, `Bundler` resolution — mirrors root `tsconfig.json`), vitest (fake timers) for tests, electron-builder for packaging, sharp for icon generation.

## Global Constraints

- macOS only; target arm64. No cross-platform code paths.
- All new code lives under `desktop/`. Do **not** add Electron deps to the root `package.json`.
- Server source is the existing repo checkout — never bundle/copy server code into the app.
- Spawn the server as: `node_abs_path <repoPath>/node_modules/tsx/dist/cli.mjs src/index.ts`, `cwd=<repoPath>`. Never rely on `npm` or shell `PATH`.
- Backoff schedule verbatim: `[1000, 5000, 15000, 60000]` ms. Attempt cap 4; the 5th consecutive failure gives up (`crashed`).
- Grace period 3000 ms (alive past grace ⇒ `running`). Stable uptime 120000 ms of `running` resets the attempt counter. SIGTERM→SIGKILL escalation after 5000 ms.
- Icon/state map: `running`=green, `starting`=amber, `stopped`=grey, `crashed`=red.
- Config path: `~/Library/Application Support/MoneyForKids/config.json`. Log path: `~/Library/Logs/MoneyForKids/server.log`.
- ESM throughout (`"type": "module"`), TypeScript `strict`.

---

### Task 1: Scaffold `desktop/` package + node-path resolver

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Create: `desktop/src/node-resolver.ts`
- Test: `desktop/test/node-resolver.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveNodePath(input: { configured?: string | null; homedir: string; exists: (p: string) => boolean; listDir: (p: string) => string[] }): string | null` — returns the first existing candidate among `[configured, /opt/homebrew/bin/node, /usr/local/bin/node, ...nvm node bins (highest version first)]`, or `null`.

- [ ] **Step 1: Create `desktop/package.json`**

```json
{
  "name": "money-for-kids-desktop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "dev": "npm run build && electron .",
    "gen-icons": "node scripts/gen-icons.mjs",
    "dist": "npm run build && electron-builder"
  },
  "devDependencies": {
    "@types/node": "^26.0.1",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "sharp": "^0.35.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Create `desktop/tsconfig.json`**

Note: this build **emits** (unlike root), so `outDir` is set and `noEmit` is absent.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install deps**

Run: `cd desktop && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Write the failing test**

Create `desktop/test/node-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveNodePath } from '../src/node-resolver';

const HOME = '/Users/me';

describe('resolveNodePath', () => {
  it('prefers the configured path when it exists', () => {
    const p = resolveNodePath({
      configured: '/custom/node',
      homedir: HOME,
      exists: (x) => x === '/custom/node',
      listDir: () => [],
    });
    expect(p).toBe('/custom/node');
  });

  it('ignores a configured path that does not exist and falls back to homebrew', () => {
    const p = resolveNodePath({
      configured: '/missing/node',
      homedir: HOME,
      exists: (x) => x === '/opt/homebrew/bin/node',
      listDir: () => [],
    });
    expect(p).toBe('/opt/homebrew/bin/node');
  });

  it('falls back to the highest nvm version when no system node exists', () => {
    const p = resolveNodePath({
      configured: null,
      homedir: HOME,
      exists: (x) => x === `${HOME}/.nvm/versions/node/v24.13.0/bin/node`,
      listDir: (dir) =>
        dir === `${HOME}/.nvm/versions/node` ? ['v18.20.0', 'v24.13.0', 'v20.11.0'] : [],
    });
    expect(p).toBe(`${HOME}/.nvm/versions/node/v24.13.0/bin/node`);
  });

  it('returns null when nothing resolves', () => {
    const p = resolveNodePath({
      configured: null,
      homedir: HOME,
      exists: () => false,
      listDir: () => [],
    });
    expect(p).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/node-resolver.test.ts`
Expected: FAIL — cannot find module `../src/node-resolver`.

- [ ] **Step 6: Implement `desktop/src/node-resolver.ts`**

```ts
export interface ResolveNodeInput {
  configured?: string | null;
  homedir: string;
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
}

/** Compare nvm version dir names like "v24.13.0" descending. */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function resolveNodePath(input: ResolveNodeInput): string | null {
  const candidates: string[] = [];
  if (input.configured) candidates.push(input.configured);
  candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node');

  const nvmRoot = `${input.homedir}/.nvm/versions/node`;
  const versions = input.listDir(nvmRoot)
    .filter((v) => /^v\d+\.\d+\.\d+$/.test(v))
    .sort(compareVersionsDesc);
  for (const v of versions) candidates.push(`${nvmRoot}/${v}/bin/node`);

  for (const c of candidates) {
    if (input.exists(c)) return c;
  }
  return null;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/node-resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add desktop/package.json desktop/tsconfig.json desktop/src/node-resolver.ts desktop/test/node-resolver.test.ts desktop/package-lock.json
git commit -m "feat(desktop): scaffold Electron package and node-path resolver"
```

---

### Task 2: Config load/save

**Files:**
- Create: `desktop/src/config.ts`
- Test: `desktop/test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface AppConfig { repoPath: string; nodePath: string | null; autoStartServerOnLaunch: boolean; openAtLogin: boolean }`
  - `function defaultConfig(repoPath: string): AppConfig`
  - `interface ConfigIO { read(): string | null; write(text: string): void }`
  - `function loadConfig(io: ConfigIO, defaults: AppConfig): AppConfig` — if `read()` is `null`, writes defaults and returns them; otherwise parses and fills any missing keys from `defaults` (then writes the merged result back).

- [ ] **Step 1: Write the failing test**

Create `desktop/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultConfig, loadConfig, type ConfigIO } from '../src/config';

function memIO(initial: string | null): ConfigIO & { current: string | null } {
  const box = { current: initial };
  return {
    current: box.current,
    read: () => box.current,
    write: (t) => { box.current = t; },
  } as ConfigIO & { current: string | null };
}

const defaults = defaultConfig('/repo');

describe('loadConfig', () => {
  it('writes and returns defaults when no file exists', () => {
    const io = memIO(null);
    const cfg = loadConfig(io, defaults);
    expect(cfg).toEqual(defaults);
    expect(JSON.parse(io.read() as string)).toEqual(defaults);
  });

  it('merges missing keys from defaults over an existing partial file', () => {
    const io = memIO(JSON.stringify({ repoPath: '/other' }));
    const cfg = loadConfig(io, defaults);
    expect(cfg.repoPath).toBe('/other');
    expect(cfg.nodePath).toBeNull();
    expect(cfg.autoStartServerOnLaunch).toBe(true);
    expect(cfg.openAtLogin).toBe(true);
  });

  it('preserves explicit false values from the file', () => {
    const io = memIO(JSON.stringify({ repoPath: '/r', openAtLogin: false }));
    const cfg = loadConfig(io, defaults);
    expect(cfg.openAtLogin).toBe(false);
  });
});

describe('defaultConfig', () => {
  it('uses the given repo path and safe defaults', () => {
    expect(defaultConfig('/x')).toEqual({
      repoPath: '/x',
      nodePath: null,
      autoStartServerOnLaunch: true,
      openAtLogin: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config`.

- [ ] **Step 3: Implement `desktop/src/config.ts`**

```ts
export interface AppConfig {
  repoPath: string;
  nodePath: string | null;
  autoStartServerOnLaunch: boolean;
  openAtLogin: boolean;
}

export interface ConfigIO {
  read(): string | null;
  write(text: string): void;
}

export function defaultConfig(repoPath: string): AppConfig {
  return {
    repoPath,
    nodePath: null,
    autoStartServerOnLaunch: true,
    openAtLogin: true,
  };
}

export function loadConfig(io: ConfigIO, defaults: AppConfig): AppConfig {
  const raw = io.read();
  if (raw === null) {
    io.write(JSON.stringify(defaults, null, 2));
    return defaults;
  }
  let parsed: Partial<AppConfig> = {};
  try {
    parsed = JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    parsed = {};
  }
  const merged: AppConfig = {
    repoPath: parsed.repoPath ?? defaults.repoPath,
    nodePath: parsed.nodePath ?? defaults.nodePath,
    autoStartServerOnLaunch: parsed.autoStartServerOnLaunch ?? defaults.autoStartServerOnLaunch,
    openAtLogin: parsed.openAtLogin ?? defaults.openAtLogin,
  };
  io.write(JSON.stringify(merged, null, 2));
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/config.ts desktop/test/config.test.ts
git commit -m "feat(desktop): config load/save with defaults merge"
```

---

### Task 3: Log rotation decision

**Files:**
- Create: `desktop/src/logger.ts`
- Test: `desktop/test/logger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `function rotationPlan(existingSize: number | null, capBytes: number): 'append' | 'rotate'` — `'rotate'` when a file exists and its size ≥ cap, else `'append'`.
  - `function createServerLog(logPath: string, capBytes?: number): NodeJS.WritableStream` — glue over `node:fs` using `rotationPlan`; not unit-tested. Default cap 5_000_000.

- [ ] **Step 1: Write the failing test**

Create `desktop/test/logger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rotationPlan } from '../src/logger';

describe('rotationPlan', () => {
  it('appends when the file does not exist', () => {
    expect(rotationPlan(null, 1000)).toBe('append');
  });
  it('appends when the file is below the cap', () => {
    expect(rotationPlan(999, 1000)).toBe('append');
  });
  it('rotates when the file is at or over the cap', () => {
    expect(rotationPlan(1000, 1000)).toBe('rotate');
    expect(rotationPlan(5000, 1000)).toBe('rotate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/logger.test.ts`
Expected: FAIL — cannot find module `../src/logger`.

- [ ] **Step 3: Implement `desktop/src/logger.ts`**

```ts
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_CAP = 5_000_000;

export function rotationPlan(existingSize: number | null, capBytes: number): 'append' | 'rotate' {
  if (existingSize === null) return 'append';
  return existingSize >= capBytes ? 'rotate' : 'append';
}

export function createServerLog(logPath: string, capBytes: number = DEFAULT_CAP): NodeJS.WritableStream {
  mkdirSync(dirname(logPath), { recursive: true });
  const size = existsSync(logPath) ? statSync(logPath).size : null;
  if (rotationPlan(size, capBytes) === 'rotate') {
    renameSync(logPath, `${logPath}.1`);
  }
  return createWriteStream(logPath, { flags: 'a' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/logger.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/logger.ts desktop/test/logger.test.ts
git commit -m "feat(desktop): rotating server log writer"
```

---

### Task 4: Server controller state machine (core)

**Files:**
- Create: `desktop/src/server-controller.ts`
- Test: `desktop/test/server-controller.test.ts`

**Interfaces:**
- Consumes: nothing (spawn injected).
- Produces:
  - `type ServerState = 'stopped' | 'starting' | 'running' | 'crashed'`
  - `interface ChildHandle { kill(signal?: NodeJS.Signals): void; on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void }`
  - `type SpawnFn = () => ChildHandle`
  - `interface CrashInfo { attempt: number; willRestart: boolean }`
  - `interface ServerControllerOptions { spawn: SpawnFn; graceMs?: number; backoffMs?: readonly number[]; stableUptimeMs?: number; killTimeoutMs?: number }`
  - `interface ServerController { start(): void; stop(): void; getState(): ServerState; on(event: 'state', listener: (s: ServerState) => void): void; on(event: 'crash', listener: (info: CrashInfo) => void): void }`
  - `function createServerController(opts: ServerControllerOptions): ServerController`
  - Defaults used by later tasks: `graceMs=3000`, `backoffMs=[1000,5000,15000,60000]`, `stableUptimeMs=120000`, `killTimeoutMs=5000`.

- [ ] **Step 1: Write the failing test**

Create `desktop/test/server-controller.test.ts`:

```ts
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
  return { handle, kill, exit: (code: number | null = 1) => em.emit('exit', code, null) };
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
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('an exit before grace is a crash that schedules a backoff restart', () => {
    const children = [makeFakeChild(), makeFakeChild()];
    const spawn = vi.fn(() => children.shift()!.handle);
    const c = createServerController({ spawn, ...OPTS });
    const crashes: CrashInfo[] = [];
    c.on('crash', (i) => crashes.push(i));

    c.start();
    // first child dies during startup
    (spawn.mock.results[0].value as ChildHandle);
    // trigger exit on the first child
    // (children array was shifted, so grab via closure below)
    // Re-run using explicit refs instead:
    expect(crashes.length).toBe(0);
  });
});
```

Note: the second test above is a scaffold; replace it and add the full suite in Step 3's companion. (The next step writes the implementation; then Step 4 replaces the test body with the complete suite below.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/server-controller.test.ts`
Expected: FAIL — cannot find module `../src/server-controller`.

- [ ] **Step 3: Implement `desktop/src/server-controller.ts`**

```ts
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
```

- [ ] **Step 4: Replace the test file with the complete suite**

Overwrite `desktop/test/server-controller.test.ts`:

```ts
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
  return { handle, kill, exit: (code: number | null = 1) => em.emit('exit', code, null) };
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
});
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `cd desktop && npx vitest run test/server-controller.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

Run: `cd desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/server-controller.ts desktop/test/server-controller.test.ts
git commit -m "feat(desktop): server controller state machine with backoff and crash handling"
```

---

### Task 5: Server spawn command + real spawn factory

**Files:**
- Create: `desktop/src/spawn-server.ts`
- Test: `desktop/test/spawn-server.test.ts`

**Interfaces:**
- Consumes: `SpawnFn`, `ChildHandle` from `server-controller.ts`; `createServerLog` from `logger.ts`.
- Produces:
  - `function buildServerCommand(repoPath: string, nodePath: string): { command: string; args: string[]; cwd: string }` — `command=nodePath`, `args=[<repoPath>/node_modules/tsx/dist/cli.mjs, 'src/index.ts']`, `cwd=repoPath`.
  - `function createSpawn(repoPath: string, nodePath: string, logPath: string): SpawnFn` — real `child_process.spawn` wired to the log stream; returns the `ChildProcess` (which satisfies `ChildHandle`). Glue; not unit-tested.

- [ ] **Step 1: Write the failing test**

Create `desktop/test/spawn-server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildServerCommand } from '../src/spawn-server';

describe('buildServerCommand', () => {
  it('invokes tsx CLI by absolute node path with repo cwd', () => {
    const cmd = buildServerCommand('/repo', '/opt/homebrew/bin/node');
    expect(cmd).toEqual({
      command: '/opt/homebrew/bin/node',
      args: ['/repo/node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
      cwd: '/repo',
    });
  });

  it('joins paths without duplicate slashes', () => {
    const cmd = buildServerCommand('/repo/', '/node');
    expect(cmd.args[0]).toBe('/repo/node_modules/tsx/dist/cli.mjs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/spawn-server.test.ts`
Expected: FAIL — cannot find module `../src/spawn-server`.

- [ ] **Step 3: Implement `desktop/src/spawn-server.ts`**

```ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { SpawnFn, ChildHandle } from './server-controller.js';
import { createServerLog } from './logger.js';

export function buildServerCommand(
  repoPath: string,
  nodePath: string,
): { command: string; args: string[]; cwd: string } {
  return {
    command: nodePath,
    args: [join(repoPath, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'],
    cwd: repoPath,
  };
}

export function createSpawn(repoPath: string, nodePath: string, logPath: string): SpawnFn {
  return () => {
    const { command, args, cwd } = buildServerCommand(repoPath, nodePath);
    const log = createServerLog(logPath);
    const child = spawn(command, args, { cwd, env: { ...process.env } });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    return child as unknown as ChildHandle;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/spawn-server.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/spawn-server.ts desktop/test/spawn-server.test.ts
git commit -m "feat(desktop): server spawn command builder and factory"
```

---

### Task 6: Icon path mapping

**Files:**
- Create: `desktop/src/icons.ts`
- Test: `desktop/test/icons.test.ts`

**Interfaces:**
- Consumes: `ServerState` from `server-controller.ts`.
- Produces: `function iconFileFor(state: ServerState): string` — returns the asset **filename** (not full path): `running`→`icon-running.png`, `starting`→`icon-starting.png`, `stopped`→`icon-stopped.png`, `crashed`→`icon-crashed.png`.

- [ ] **Step 1: Write the failing test**

Create `desktop/test/icons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { iconFileFor } from '../src/icons';

describe('iconFileFor', () => {
  it('maps each state to its asset filename', () => {
    expect(iconFileFor('running')).toBe('icon-running.png');
    expect(iconFileFor('starting')).toBe('icon-starting.png');
    expect(iconFileFor('stopped')).toBe('icon-stopped.png');
    expect(iconFileFor('crashed')).toBe('icon-crashed.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run test/icons.test.ts`
Expected: FAIL — cannot find module `../src/icons`.

- [ ] **Step 3: Implement `desktop/src/icons.ts`**

```ts
import type { ServerState } from './server-controller.js';

export function iconFileFor(state: ServerState): string {
  return `icon-${state}.png`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run test/icons.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/icons.ts desktop/test/icons.test.ts
git commit -m "feat(desktop): map server state to dock icon asset"
```

---

### Task 7: Electron main glue

**Files:**
- Create: `desktop/src/main.ts`
- (No unit test — thin Electron glue, verified manually in Task 8 after icons exist.)

**Interfaces:**
- Consumes: `createServerController` + `ServerState` (server-controller.ts), `loadConfig`/`defaultConfig` (config.ts), `resolveNodePath` (node-resolver.ts), `createSpawn` (spawn-server.ts), `iconFileFor` (icons.ts).
- Produces: the Electron entry point (`dist/main.js` per `package.json` `main`). No exported API.

- [ ] **Step 1: Implement `desktop/src/main.ts`**

```ts
import { app, dialog, Menu, Notification, nativeImage } from 'electron';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerController, type ServerState } from './server-controller.js';
import { defaultConfig, loadConfig, type ConfigIO, type AppConfig } from './config.js';
import { resolveNodePath } from './node-resolver.js';
import { createSpawn } from './spawn-server.js';
import { iconFileFor } from './icons.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');

const SUPPORT_DIR = join(homedir(), 'Library', 'Application Support', 'MoneyForKids');
const CONFIG_PATH = join(SUPPORT_DIR, 'config.json');
const LOG_PATH = join(homedir(), 'Library', 'Logs', 'MoneyForKids', 'server.log');
// Default repo path: the checkout this app was built from — two levels up from desktop/dist.
const DEFAULT_REPO = join(__dirname, '..', '..');

function configIO(path: string): ConfigIO {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: (text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function setDockIcon(state: ServerState): void {
  const img = nativeImage.createFromPath(join(ASSETS, iconFileFor(state)));
  if (!img.isEmpty()) app.dock?.setIcon(img);
}

app.on('window-all-closed', () => {
  // Dock-only app: never quit just because there are no windows.
});

app.whenReady().then(() => {
  const config: AppConfig = loadConfig(configIO(CONFIG_PATH), defaultConfig(DEFAULT_REPO));

  app.setLoginItemSettings({ openAtLogin: config.openAtLogin });

  const nodePath = resolveNodePath({
    configured: config.nodePath,
    homedir: homedir(),
    exists: (p) => existsSync(p),
    listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  });

  if (!nodePath) {
    setDockIcon('crashed');
    notify('Money for Kids', `Node not found. Set "nodePath" in ${CONFIG_PATH}`);
    buildDockMenu('crashed', () => {}, () => {}, config);
    return;
  }

  const controller = createServerController({
    spawn: createSpawn(config.repoPath, nodePath, LOG_PATH),
  });

  const doStart = () => controller.start();
  const doStop = () => controller.stop();

  controller.on('state', (state) => {
    setDockIcon(state);
    buildDockMenu(state, doStart, doStop, config);
  });

  controller.on('crash', ({ attempt, willRestart }) => {
    notify(
      'Money for Kids',
      willRestart
        ? `Ledger server crashed — restarting (attempt ${attempt}).`
        : `Ledger server keeps crashing — gave up after ${attempt} attempts.`,
    );
  });

  // Dock icon click: toggle with confirm-on-stop.
  app.on('activate', () => {
    const state = controller.getState();
    if (state === 'running') {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Cancel', 'Stop'],
        defaultId: 0,
        cancelId: 0,
        message: 'Stop the ledger server?',
        detail: 'The Telegram account will go offline until you start it again.',
      });
      if (choice === 1) doStop();
    } else if (state === 'stopped' || state === 'crashed') {
      doStart();
    }
    // 'starting' -> ignore
  });

  app.on('before-quit', () => controller.stop());

  setDockIcon('stopped');
  buildDockMenu('stopped', doStart, doStop, config);

  if (config.autoStartServerOnLaunch) doStart();
});

function buildDockMenu(
  state: ServerState,
  onStart: () => void,
  onStop: () => void,
  config: AppConfig,
): void {
  const isRunning = state === 'running';
  const isBusy = state === 'starting';
  const menu = Menu.buildFromTemplate([
    { label: 'Start', enabled: !isRunning && !isBusy, click: onStart },
    { label: 'Stop', enabled: isRunning, click: onStop },
    { type: 'separator' },
    { label: 'Open log', click: () => { void import('electron').then(({ shell }) => shell.openPath(LOG_PATH)); } },
    { label: 'Open config', click: () => { void import('electron').then(({ shell }) => shell.openPath(CONFIG_PATH)); } },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: config.openAtLogin,
      click: (item) => {
        config.openAtLogin = item.checked;
        app.setLoginItemSettings({ openAtLogin: item.checked });
        configIO(CONFIG_PATH).write(JSON.stringify(config, null, 2));
      },
    },
    { type: 'separator' },
    { role: 'quit' },
  ]);
  app.dock?.setMenu(menu);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd desktop && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `cd desktop && npm run build`
Expected: `dist/main.js` and sibling `.js` files produced, no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main.ts
git commit -m "feat(desktop): Electron main — dock icon, menu, toggle, login item"
```

---

### Task 8: Icon assets, packaging, docs, manual verification

**Files:**
- Create: `desktop/scripts/gen-icons.mjs`
- Create: `desktop/assets/.gitkeep` (generated PNGs are git-ignored)
- Create: `desktop/electron-builder.yml`
- Create: `desktop/README.md`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: `iconFileFor` filenames (`icon-running.png`, etc.) — the generator must produce exactly these names plus `icon.png` (base app icon).
- Produces: runnable/packageable app.

- [ ] **Step 1: Create the icon generator `desktop/scripts/gen-icons.mjs`**

Generates a base rounded-square icon and four status variants (a colored status dot in the corner) using sharp.

```js
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(assets, { recursive: true });

const SIZE = 512;
const DOT = 150;
const COLORS = { running: '#28c840', starting: '#f5b800', stopped: '#8e8e93', crashed: '#ff3b30' };

function baseSvg() {
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <rect x="24" y="24" width="464" height="464" rx="96" fill="#1f6feb"/>
       <text x="50%" y="54%" font-family="Helvetica" font-size="230" fill="white"
             text-anchor="middle" dominant-baseline="middle" font-weight="bold">₴</text>
     </svg>`,
  );
}

function dotSvg(color) {
  return Buffer.from(
    `<svg width="${DOT}" height="${DOT}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${DOT / 2}" cy="${DOT / 2}" r="${DOT / 2 - 10}" fill="${color}"
               stroke="white" stroke-width="16"/>
     </svg>`,
  );
}

const base = await sharp(baseSvg()).png().toBuffer();
await sharp(base).toFile(join(assets, 'icon.png'));

for (const [state, color] of Object.entries(COLORS)) {
  await sharp(base)
    .composite([{ input: await sharp(dotSvg(color)).png().toBuffer(), top: SIZE - DOT - 12, left: SIZE - DOT - 12 }])
    .toFile(join(assets, `icon-${state}.png`));
  console.log(`wrote icon-${state}.png`);
}
```

- [ ] **Step 2: Generate the icons**

Run: `cd desktop && npm run gen-icons`
Expected: `assets/icon.png` + `icon-running.png`, `icon-starting.png`, `icon-stopped.png`, `icon-crashed.png` written.

- [ ] **Step 3: Create `desktop/assets/.gitkeep`**

Empty file so the directory is tracked while the generated PNGs stay ignored.

```
```

- [ ] **Step 4: Create `desktop/electron-builder.yml`**

```yaml
appId: com.pemakhov.moneyforkids
productName: Money for Kids
directories:
  output: release
files:
  - dist/**
  - assets/**
  - package.json
mac:
  target: dir
  category: public.app-category.utilities
  icon: assets/icon.png
```

(`target: dir` produces an unsigned `.app` under `release/mac-arm64/` — enough for personal local use with no Apple Developer signing.)

- [ ] **Step 5: Update repo-root `.gitignore`**

Add these lines:

```
desktop/node_modules/
desktop/dist/
desktop/release/
desktop/assets/*.png
```

- [ ] **Step 6: Run the full desktop test suite + typecheck**

Run: `cd desktop && npm test && npm run typecheck`
Expected: all tests PASS (node-resolver 4, config 5, logger 4, server-controller 6, spawn-server 2, icons 1), no type errors.

- [ ] **Step 7: Manual smoke test (dev run)**

Run: `cd desktop && npm run dev`
Verify by observation:
1. A dock icon appears with a grey dot, then (auto-start) amber, then green within ~3s.
2. `~/Library/Logs/MoneyForKids/server.log` fills with the server's startup output.
3. Click the dock icon → a "Stop the ledger server?" dialog appears; **Cancel** leaves it running; clicking again then **Stop** turns the icon grey and the server process exits.
4. Click the grey icon → starts again (amber→green).
5. Right-click the dock icon → menu shows Start/Stop (correct enablement), Open log, Open config, Open at login (checked), Quit.
6. Quit → the child server process is gone (`pgrep -f "tsx/dist/cli.mjs src/index.ts"` returns nothing).

If icons don't swap, confirm the PNGs exist in `desktop/assets/` and re-run Step 2.

- [ ] **Step 8: Package the app**

Run: `cd desktop && npm run dist`
Expected: `desktop/release/mac-arm64/Money for Kids.app` created.

- [ ] **Step 9: Install & verify login item**

```bash
cp -R "desktop/release/mac-arm64/Money for Kids.app" /Applications/
open "/Applications/Money for Kids.app"
```
Verify: dock icon appears and the server auto-starts; System Settings → General → Login Items lists "Money for Kids". Right-click dock → Options → "Keep in Dock" to pin it.

- [ ] **Step 10: Write `desktop/README.md`**

```markdown
# Money for Kids — Dock Controller

A window-less macOS dock app that supervises the ledger server (`tsx src/index.ts`)
from this repo.

## What it does
- Auto-starts the server at login and on app launch.
- Dock icon color = state: green running, amber starting, grey stopped, red crashed.
- Click the dock icon to toggle: starts immediately when stopped; asks to confirm before stopping.
- Auto-restarts on crash with backoff (1s/5s/15s/60s), notifying each time; gives up after 5 failures.

## Build & install
```bash
cd desktop
npm install
npm run gen-icons     # generates assets/*.png
npm run dist          # builds release/mac-arm64/Money for Kids.app
cp -R "release/mac-arm64/Money for Kids.app" /Applications/
open "/Applications/Money for Kids.app"
```
Right-click the dock icon → Options → "Keep in Dock" to pin it.

## Configuration
`~/Library/Application Support/MoneyForKids/config.json`:
- `repoPath` — where the server lives (defaults to this checkout).
- `nodePath` — override the Node binary (auto-resolved from Homebrew/nvm/`/usr/local` if null).
- `autoStartServerOnLaunch`, `openAtLogin` — booleans.

Logs: `~/Library/Logs/MoneyForKids/server.log` (Dock menu → Open log).

## Development
```bash
npm test          # vitest unit tests (controller, config, resolver, ...)
npm run dev       # build + launch Electron locally
```
```

- [ ] **Step 11: Commit**

```bash
git add desktop/scripts/gen-icons.mjs desktop/assets/.gitkeep desktop/electron-builder.yml desktop/README.md .gitignore
git commit -m "feat(desktop): icon generator, packaging, docs, gitignore"
```

---

## Self-Review

**Spec coverage:**
- Window-less dock app → Tasks 7 (no BrowserWindow), 8 (packaging). ✓
- Toggle w/ confirm on stop → Task 7 `activate` handler. ✓
- Auto-start at launch/login → Task 7 (`autoStartServerOnLaunch`, `setLoginItemSettings`). ✓
- Dock icon color = state → Tasks 6 (mapping) + 7 (`setDockIcon`) + 8 (assets). ✓
- Crash auto-restart + backoff + notification, give up after cap → Task 4 + Task 7 crash handler. ✓
- Stable-uptime counter reset → Task 4. ✓
- Intentional stop no-restart, SIGTERM→SIGKILL → Task 4. ✓
- Point at repo checkout, absolute node, tsx CLI, no PATH reliance → Task 5 + Global Constraints. ✓
- Node path resolution order → Task 1. ✓
- Config JSON keys/defaults/path → Task 2 + Task 7. ✓
- Rotating log at fixed path → Task 3 + Task 5. ✓
- Dock menu (Start/Stop/Open log/Open at login/Quit) → Task 7. ✓
- Error handling (node missing, spawn error, unexpected exit) → Task 7 (node missing) + Task 4 (spawn error/exit as crash). ✓
- `desktop/` self-contained, no Electron deps in root → Task 1 + Global Constraints. ✓
- Unit tests for controller (all listed cases); main is thin glue, not unit-tested → Task 4 + Task 7. ✓

**Placeholder scan:** The only intentional two-phase artifact is Task 4's Step 1 scaffold test, explicitly replaced by the full suite in Step 4 — every other step contains complete code/commands. No TBD/TODO. ✓

**Type consistency:** `ServerState`, `ChildHandle`, `SpawnFn`, `CrashInfo`, `ServerController` are defined in Task 4 and consumed unchanged in Tasks 5–7. `AppConfig`/`ConfigIO` defined in Task 2, consumed in Task 7. `resolveNodePath` signature identical in Tasks 1 and 7. `iconFileFor` returns filenames matched by the generator in Task 8. `buildServerCommand` shape consistent between Tasks 5 and its use in `createSpawn`. ✓
