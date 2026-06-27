# Money for Kids — Telegram Bot

Tracks kids' expenses for two co-parents in a shared Telegram group, marks each
accounted message with a 👍 reaction, and reports monthly 50/50 balances.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Get both participants' numeric Telegram IDs (e.g. via [@userinfobot](https://t.me/userinfobot)).
3. `cp .env.example .env` and fill in `BOT_TOKEN`, `USER1_ID` (Сергій), `USER2_ID` (Марина).
4. `npm install`
5. In @BotFather, disable the bot's group privacy so it can read all group messages.
6. Add the bot to your group.

## Run

- `npm start` — start the bot (long polling).
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

- Money is stored in integer cents in a local SQLite file (`DB_PATH`, default `./data/expenses.db`). Back up by copying that file.
- Timezone defaults to `Europe/Kyiv` (`TIMEZONE` env).

## Limitations

- An expense is any message whose **first token is a number**, so a message that
  happens to start with a number (e.g. a date like `10.06.2026 ...`) will be logged.
  Start non-expense messages with a non-numeric character.
- Editing a message after it was accounted does **not** update the stored expense;
  the bot only reacts to new messages. Post a correction as a new message instead.
