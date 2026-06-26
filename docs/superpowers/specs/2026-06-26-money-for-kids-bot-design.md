# Money for Kids — Telegram Bot Design

**Date:** 2026-06-26
**Status:** Approved design

## Purpose

A Telegram bot for two co-parents (Сергій and Марина) to track money each spends
on their kids in a shared group chat. Each person posts plain messages describing
an expense; the bot accounts for them and, on demand, reports monthly totals and
how much one parent must compensate the other (costs split 50/50).

## Participants

Two fixed participants, identified by Telegram **user ID**:

- `USER1` — display name **Сергій** (constant in code)
- `USER2` — display name **Марина** (constant in code)

User IDs are supplied via `.env` (not yet known); display names are hardcoded
constants. Messages from any other user are ignored for accounting.

## Behavior

### Expense messages

- A group message whose **first token is a number** is an expense.
  Example: `4000 гривень Ігорю на місяць` → amount `4000`.
- The amount parser accepts: `4000`, `4 000` (space thousands separator),
  `4000.50`, `4000,50` (comma decimal). Currency is assumed UAH (₴).
- On a valid expense from a configured user, the bot:
  1. stores it, attributed to the sender, with accounting month = the calendar
     month of the message (in the configured timezone), and
  2. reacts **✅** on the message.
- Messages not starting with a number, or from non-participants, are ignored
  (no reaction, no storage).
- If the bot lacks reaction permission, it falls back to a short text reply.

### Commands

- **`/balance`** — table for the **current** accounting month.
- **`/balance_previous`** — table for the **previous** accounting month. Because
  each expense stores an explicit accounting month, this includes both real
  previous-month messages and ones reassigned via `/to_previous`.
- **`/to_previous 300 Максу на бутерброд`** — records an expense dated to the
  **previous** month (amount parsed as the first token after the command, rest is
  the description). Source marked `to_previous`. The bot confirms with a reply,
  e.g. `↩️ Зараховано в Травень: 300 ₴`. If no parseable amount follows, the bot
  replies with usage help.

### Monthly banner

- At **00:00 on the 1st of each month** (configured timezone, `Europe/Kyiv` by
  default), the bot posts a generated **PNG image banner** with the month name
  rendered large, e.g. **ЧЕРВЕНЬ 2026**.
- The banner is built as an SVG (Ukrainian month name + year) rasterized to PNG
  via `sharp`, then sent as a photo.
- The destination group chat ID is captured automatically from chat activity and
  stored in the `meta` table; the banner posts there.

## Balance calculation (50/50)

For a given accounting month:

- `total = sum(USER1) + sum(USER2)`
- Each parent's fair share = `total / 2`.
- Compensation = `(higher_paid − lower_paid) / 2`; the parent who paid **less**
  compensates the parent who paid **more** by that amount.
- If totals are equal (or both zero), no compensation is owed.

### Table format (Ukrainian)

```
Баланс за Червень 2026

Сергій:  4000 ₴
Марина:  1000 ₴
Разом:   5000 ₴

Марина має компенсувати Сергію: 1500 ₴
```

## Data model (SQLite, via better-sqlite3)

```
expenses(
  id               INTEGER PRIMARY KEY,
  chat_id          INTEGER NOT NULL,
  message_id       INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  user_name        TEXT    NOT NULL,
  amount_cents     INTEGER NOT NULL,   -- minor units; avoids float errors
  description      TEXT,
  accounting_year  INTEGER NOT NULL,
  accounting_month INTEGER NOT NULL,   -- 1..12
  created_at_utc   TEXT    NOT NULL,   -- ISO 8601 UTC
  source           TEXT    NOT NULL,   -- 'message' | 'to_previous'
  UNIQUE(chat_id, message_id)          -- guard double-count on redelivery
)

meta(
  key   TEXT PRIMARY KEY,             -- e.g. 'group_chat_id'
  value TEXT NOT NULL
)
```

Amounts stored as integer cents. `(chat_id, message_id)` unique prevents double
counting if Telegram redelivers an update after a restart. `/to_previous`
commands have a real `message_id` (the command message) so they are deduped too.

## Architecture

Long polling (no public URL needed). Pure logic separated from Telegram glue so
it can be unit-tested.

```
src/
  index.ts          entrypoint: load config, init db, start bot, schedule cron
  config.ts         parse + validate .env; name constants (Сергій, Марина)
  db.ts             sqlite init, schema, prepared queries
  parser.ts         extract amount (cents) from message text   [pure, tested]
  dates.ts          TZ-aware month-bucket helpers (luxon)       [pure, tested]
  balance.ts        compute totals + who-owes-whom              [pure, tested]
  format.ts         build Ukrainian balance table + month names [pure, tested]
  banner.ts         month/year -> PNG (svg + sharp)
  scheduler.ts      node-cron monthly banner post
  handlers/
    expense.ts      number-message -> store + react ✅
    balance.ts      /balance, /balance_previous
    toPrevious.ts   /to_previous
.env.example
package.json
tsconfig.json
README.md
data/               sqlite db file (gitignored)
```

### Data flow

1. Update arrives (long polling) → grammY routes it.
2. Command updates go to command handlers; other text goes to the expense handler.
3. Handlers call pure modules (parser/dates/balance/format) and `db` queries.
4. cron (scheduler) fires monthly → `banner` builds PNG → bot sends photo to the
   stored group chat.

## Error handling

- `/to_previous` without a parseable amount → reply with usage help; nothing stored.
- Missing reaction permission → fall back to a text reply confirmation.
- Unique `(chat_id, message_id)` → idempotent; redelivered updates do not double count.
- Missing/invalid `.env` (token or user IDs) → fail fast at startup with a clear error.
- Banner send before any group activity recorded (no stored chat ID) → log a
  warning and skip that run.

## Testing

- Built with TDD (vitest). Pure modules fully unit-tested:
  - `parser`: `4000`, `4 000`, `4000.50`, `4000,50`, non-numbers, leading text.
  - `dates`: current/previous month buckets across year boundary, in `Europe/Kyiv`.
  - `balance`: 50/50 split, equal totals, one-sided, zero, rounding of cents.
  - `format`: table text and Ukrainian month-name genitive/nominative forms.
- Handlers kept thin; tested with grammY's test utilities or injected fake context.

## Configuration (`.env`)

```
BOT_TOKEN=...
USER1_ID=...
USER2_ID=...
TIMEZONE=Europe/Kyiv
DB_PATH=./data/expenses.db
```

Display names (`Сергій`, `Марина`) are constants in `config.ts`, not env vars.

## Out of scope (YAGNI)

- Editing/deleting already-accounted expenses (could be a later command).
- Custom split ratios (fixed 50/50).
- More than two participants.
- Multi-currency.
