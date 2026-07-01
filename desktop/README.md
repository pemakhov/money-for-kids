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
