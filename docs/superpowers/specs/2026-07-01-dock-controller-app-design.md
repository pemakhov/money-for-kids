# Money for Kids — macOS Dock Controller App

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan

## Purpose

Give the always-on Telegram ledger server (`tsx src/index.ts`) a pinnable macOS
dock presence. One dock icon that: auto-starts the server at login, shows its
live state through the icon color, and lets the user toggle it with a click
(confirming before a stop).

## Non-goals (YAGNI)

- No status window, no menu-bar item, no in-app log viewer (only "open the log file").
- No auto-update mechanism.
- No cross-platform support — macOS only.

## Interaction model

The app is a **window-less Electron app**. Its only UI surface is the dock icon
and the dock right-click menu.

State machine: `stopped → starting → running`, plus a terminal `crashed` state.

| Trigger | Behavior |
|---|---|
| App launch (including at login) | Auto-start the server: `starting` (amber) → `running` (green). |
| Dock icon click while `stopped` or `crashed` | Start the server immediately (no dialog). |
| Dock icon click while `running` | Show a native confirm dialog "Stop the ledger server?". Stop **only** after the user clicks **Stop** ("submit"). Cancel is a no-op. |
| Dock icon click while `starting` | No-op (ignore until state settles). |

Dock right-click menu items: **Start/Stop** (label reflects state), **Open log**,
**Open at login** (checkable toggle), **Quit** (kills the server, then exits).

Dock icon → state mapping (full-icon swap via `app.dock.setIcon`):

- `running` → green
- `starting` → amber
- `stopped` → grey
- `crashed` → red

## Crash handling

If the child process exits while the controller expected it `running` (i.e. not a
user-initiated stop):

1. Increment the restart-attempt counter.
2. Restart after a backoff delay following the schedule `[1s, 5s, 15s, 60s]`.
   The attempt cap is 4 (one per schedule entry); the 5th consecutive failure
   gives up.
3. Post a macOS notification on each crash/restart (e.g. "Ledger server crashed —
   restarting (attempt 2)").
4. On the 5th consecutive failure (cap exhausted), enter `crashed` (red icon)
   and wait for a manual dock click to retry.

A **stable uptime** of more than 2 minutes resets the attempt counter back to 0.

A **user-initiated Stop** sets an `intentional` flag so the exit handler does
**not** auto-restart; state becomes `stopped`.

## Running the server

The controller **points at the existing repo checkout** — it does not bundle the
server code. `git pull` in the repo updates the server with no app rebuild.

### PATH problem

GUI apps launched from Finder or at login do **not** inherit the user's shell
`PATH`, so `npm` / `node` may not resolve. To avoid this entirely, the controller
spawns Node by absolute path and invokes tsx's CLI directly rather than going
through `npm`:

```
spawn(nodePath, [
  path.join(repoPath, 'node_modules/tsx/dist/cli.mjs'),
  'src/index.ts',
], { cwd: repoPath, env: { ...process.env } })
```

### Node path resolution

`nodePath` is resolved in this order, first hit wins:

1. `nodePath` from the config file, if set.
2. Common install locations, probed for existence:
   `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and the current nvm default
   (`~/.nvm/versions/node/*/bin/node`, highest version).

If none resolve → `crashed` state + notification "Node not found — set nodePath in
the config file" (menu offers "Open config").

### `running` detection

The server takes a few seconds to connect to Telegram. Detection is
uptime-based to avoid modifying the server: after spawn the state is `starting`;
if the process stays alive past a short grace period (3s) it transitions to
`running`. If it exits before the grace period elapses, that counts as a crash.

### Logging

Child `stdout`/`stderr` are piped to a rotating log file at
`~/Library/Logs/MoneyForKids/server.log` (rotate at a size cap, keep 1 previous
file). The dock menu "Open log" opens this file.

## Configuration

A JSON config at `~/Library/Application Support/MoneyForKids/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `repoPath` | absolute path to this repo checkout | Where the server lives. |
| `nodePath` | `null` (auto-resolve) | Override for the Node binary. |
| `autoStartServerOnLaunch` | `true` | Start the server when the app launches. |
| `openAtLogin` | `true` | Register the app as a login item. |

`openAtLogin` is applied via `app.setLoginItemSettings({ openAtLogin })` on
startup and toggled from the dock menu. The config is created with defaults on
first run.

## Structure & build

A self-contained `desktop/` folder with its **own** `package.json` so Electron
dependencies stay out of the server package:

```
desktop/
  package.json              # electron + electron-builder + tsx/typescript for build
  tsconfig.json
  electron-builder.yml
  src/
    main.ts                 # Electron lifecycle, dock icon/menu, activate→toggle
    server-controller.ts    # state machine + child process (the testable core)
    config.ts               # load/save config JSON
    logger.ts               # rotating log file
    icons.ts                # state → icon asset path
    node-resolver.ts        # absolute node path resolution
  assets/
    icon-running.png, icon-starting.png, icon-stopped.png, icon-crashed.png
    icon.icns               # base app icon
  test/
    server-controller.test.ts
```

### Module responsibilities

- **`server-controller.ts`** — owns the state machine and the child process.
  Public surface: `start()`, `stop()` (intentional), `getState()`, and an event
  emitter for state transitions. Depends on `node-resolver`, `config`, `logger`.
  Timers and `child_process` are injectable so tests can substitute fakes.
- **`main.ts`** — thin Electron glue: creates no `BrowserWindow`, wires the
  `activate` (dock click) handler to the controller, builds the dock menu,
  subscribes to controller state events to swap the dock icon and post
  notifications, applies login-item settings. No business logic.
- **`config.ts`** — read/write/default the config JSON.
- **`logger.ts`** — open/rotate the log file, expose a writable stream for the
  child's stdio.
- **`icons.ts`** — map a state value to an asset path.
- **`node-resolver.ts`** — resolve the absolute Node binary path.

### Build & install

`electron-builder` produces `MoneyForKids.app` (arm64). The user drags it to
`/Applications`. First launch writes the default config and (because
`openAtLogin` defaults true) registers the login item.

## Error handling

| Condition | Result |
|---|---|
| Node binary not found | `crashed` + notification, "Open config" in menu. |
| `repoPath` missing / `src/index.ts` absent | `crashed` + notification naming the path. |
| Spawn error (EACCES, etc.) | Treated as a crash → backoff path. |
| Child exits 0 unexpectedly while `running` | Treated as a crash (server should stay up). |
| User Stop while process ignores SIGTERM | Escalate to SIGKILL after a timeout. |

## Testing

Unit-test `server-controller.ts` with vitest using fake timers and a mocked
`child_process`:

- `start()` from `stopped`: spawns, transitions `starting → running` after grace.
- Exit before grace period → crash → backoff → restart.
- Crash loop exhausts attempt cap → `crashed`, no further auto-restart.
- Intentional `stop()` → `stopped`, exit handler does not restart.
- Stable uptime > 2 min resets the attempt counter.
- SIGTERM-then-SIGKILL escalation on stop timeout.

`main.ts` is thin Electron glue and is not unit-tested.
