# Money for Kids — Telegram Bot

Tracks kids' expenses for two co-parents in a shared Telegram group, marks each
accounted message with a 👍 reaction, and reports monthly 50/50 balances.

The ledger runs as two Telegram clients working together:

- a **grammy bot** that owns native slash commands, the 👍 reactions, replies,
  and the monthly banner post;
- a **silent MTProto/gramjs reader** account that only fetches chat history so
  the ledger can recompute balances on demand.

## Setup

1. Make sure your family group is a **supergroup** (not a basic group) —
   convert it if needed. The bot and the MTProto reader must share one
   message-id space, and basic groups don't guarantee that.
2. Create a bot via [@BotFather](https://t.me/BotFather):
   - `/newbot` to create it and get its token.
   - `/setprivacy` → **Disable** for the bot, so it can see all group messages
     (not just commands), not just messages addressed to it.
   - Add the bot to your family group and **promote it to admin** (it needs
     admin rights to add reactions in the group).
3. Create a dedicated Telegram account for the silent MTProto reader and add
   it to the group too.
4. Get `API_ID` and `API_HASH` from https://my.telegram.org (under API development tools).
5. Get both participants' numeric Telegram IDs (e.g. via [@userinfobot](https://t.me/userinfobot)).
6. `npm install`
7. `cp .env.example .env` and fill in `API_ID`, `API_HASH`, `BOT_TOKEN` (from BotFather), `GROUP_CHAT_ID` (numeric group id, e.g. -1001234567890), `USER1_ID` (Сергій), `USER2_ID` (Марина), and optionally `TIMEZONE`.
8. Run `npm run login` once, follow the prompts, and paste the printed `TELEGRAM_SESSION` value into `.env`.
9. `npm start`

A missing `BOT_TOKEN` (or any other required env var) is a hard startup crash —
see `src/config.ts`.

## Run

- `npm start` — start the bot and the MTProto reader together.
- `npm run dev` — start with auto-reload.
- `npm test` — run the test suite.
- `npm run typecheck` — type-check without emitting.

## Usage

- Any message starting with a number is logged as an expense by its sender and marked with a 👍 reaction. Example: `4000 гривень Ігорю на місяць`.
- `/balance` — totals and who-owes-whom for the current month.
- `/balance_previous` — same for the previous month (includes `/to_previous` entries).
- `/to_previous <сума> <опис>` — log an expense into the previous month, e.g. `/to_previous 300 Максу на бутерброд`.
- `/month` — post a banner image with the current month's name.
- On the 1st of each month the bot posts a banner image with the month name.

## Notes

- **No database**: all state lives in Telegram. The bot's 👍 reactions mark counted expenses, and the ledger recomputes the balance from chat history on demand (on `/balance`, `/balance_previous`, at startup, and before the monthly banner).
- **Reconciliation**: edits and deletes are automatically reconciled by re-reading history. If the bot or the MTProto reader was offline, reconciliation happens at the next balance check, startup, or wake from sleep.
- The MTProto account is a silent history reader: it stays in the group and fetches messages for the balance recompute, but never posts or reacts.
- Timezone defaults to `Europe/Kyiv` (`TIMEZONE` env).

## Reliability on a sleeping laptop

The server is meant to run unattended on a Mac that sleeps whenever the lid
closes. Sleep silently kills both Telegram connections — the sockets stay open
as far as either side can tell — so the server watches for that and heals
itself instead of waiting to be restarted.

- **Wake detection** (`src/watchdog.ts`): a timer compares wall-clock time
  against its own tick rate, and a jump means the machine slept. On wake the
  server drops its pooled Bot API sockets, reconnects the MTProto reader, and
  re-runs a reconcile so anything posted during the sleep still gets its 👍.
- **Bounded API timeout**: a Bot API call gives up after 45s rather than
  grammy's default of 500s, so even an unnoticed stall clears in under a
  minute instead of leaving the bot deaf for eight.
- **Health monitor**: every 30s it checks that long polling is still returning
  and that the MTProto reader is connected, and repairs whichever half is
  broken. After 10 consecutive unhealthy checks (~5 minutes) it exits non-zero
  so the dock controller can start a clean process.
- **Unlimited MTProto reconnects**: gramjs gives up for good once a finite
  retry count runs out, and a wake burns through a handful of attempts while
  Wi-Fi reassociates. That is what used to leave `/balance` hanging until a
  manual restart.
- **Missed monthly banner**: the 1st-of-the-month post still happens when the
  machine slept through midnight (up to a week late).

While the Mac is actually asleep the bot is off, and nothing here changes that
— messages sent during a sleep are handled once it wakes.

## Limitations

- An expense is any message whose **first token is a number**, so a message that
  happens to start with a number (e.g. a date like `10.06.2026 ...`) will be logged.
  Start non-expense messages with a non-numeric character.
- Editing or deleting a message while the bot or the MTProto reader is offline will reconcile at the next balance check, startup, or wake from sleep, not instantly.
- Detecting whether the bot already reacted 👍 to a message relies on Telegram's `recentReactions`, a bounded window of recent reactors that Telegram may truncate or return empty. Balance totals are unaffected (they come from re-classifying history), but if the bot's reaction falls out of that window, a stale 👍 may not get cleared by reconcile.
