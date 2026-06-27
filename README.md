# Money for Kids — Telegram Bot

Tracks kids' expenses for two co-parents in a shared Telegram group, marks each
accounted message with a 👍 reaction, and reports monthly 50/50 balances.

## Setup

1. Create a dedicated Telegram account and add it to your family group.
2. Get `API_ID` and `API_HASH` from https://my.telegram.org (under API development tools).
3. Get both participants' numeric Telegram IDs (e.g. via [@userinfobot](https://t.me/userinfobot)).
4. `npm install`
5. `cp .env.example .env` and fill in `API_ID`, `API_HASH`, `GROUP_CHAT_ID` (numeric group id, e.g. -1001234567890), `USER1_ID` (Сергій), `USER2_ID` (Марина), and optionally `TIMEZONE`.
6. Run `npm run login` once, follow the prompts, and paste the printed `TELEGRAM_SESSION` value into `.env`.
7. `npm start`

## Run

- `npm start` — start the ledger account.
- `npm run dev` — start with auto-reload.
- `npm test` — run the test suite.
- `npm run typecheck` — type-check without emitting.

## Usage

- Any message starting with a number is logged as an expense by its sender and marked with a 👍 reaction. Example: `4000 гривень Ігорю на місяць`.
- `/balance` — totals and who-owes-whom for the current month.
- `/balance_previous` — same for the previous month (includes `/to_previous` entries).
- `/to_previous <сума> <опис>` — log an expense into the previous month, e.g. `/to_previous 300 Максу на бутерброд`.
- On the 1st of each month the bot posts a banner image with the month name.

## Notes

- **No database**: all state lives in Telegram. The account's 👍 reactions mark counted expenses, and the ledger recomputes the balance from chat history on demand (on `/balance`, `/balance_previous`, at startup, and before the monthly banner).
- **Reconciliation**: edits and deletes are automatically reconciled by re-reading history. If the dedicated account was offline, reconciliation happens at the next balance check or startup.
- Timezone defaults to `Europe/Kyiv` (`TIMEZONE` env).

## Limitations

- An expense is any message whose **first token is a number**, so a message that
  happens to start with a number (e.g. a date like `10.06.2026 ...`) will be logged.
  Start non-expense messages with a non-numeric character.
- Editing or deleting a message while the account is offline will reconcile at the next balance check or startup, not instantly.
