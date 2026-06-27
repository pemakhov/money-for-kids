# Stateless MTProto Ledger — Design

**Date:** 2026-06-27
**Status:** Approved, pending implementation plan
**Supersedes:** the stateful grammY + SQLite design (`2026-06-26-money-for-kids-bot-design.md`)

## Problem

The current bot is a stateful grammY bot backed by SQLite. It records each expense
message into a database and computes balances from that database. This drifts from
reality whenever the underlying chat changes:

- **Deletes are invisible.** The Bot API never notifies a bot of a deletion, so a
  deleted expense stays counted forever.
- **Edits and offline posts have a 24h wall.** Long polling queues updates
  server-side for at most ~24h. If the bot is offline longer, those updates are lost
  with no way to backfill.

The requirement is that the balance be **eventually reliably consistent** with the
chat: if a participant posts, edits, or deletes a message while the process is
offline, the balance must converge to the correct value once the process is running
again.

## Why the Bot API cannot satisfy this

A bot token provides a *push event stream*, not a *queryable state*:

| Event while offline | Bot gets on return | Consistent? |
|---|---|---|
| New message | Delivered from server queue, **~24h retention only** | ✅ < 24h, ❌ otherwise (permanent gap) |
| Edit | `edited_message`, same ~24h retention | ✅ < 24h, ❌ otherwise |
| Delete | **Nothing, ever** — no delete update exists | ❌ always (permanent blind spot) |

Eventual consistency requires reading the **authoritative current state** of the chat
at reconcile time. A bot token cannot read history, so it cannot reconcile. This is a
structural limitation, not a code problem.

## Chosen approach: MTProto user account, stateless, reaction-as-truth

Run a single long-running process logged into Telegram as a **dedicated ledger
account** (a real user account, not a `@BotFather` bot) via **MTProto (GramJS)**. A
user account *can* read chat history, so it can re-read the authoritative state and
reconcile on demand.

Two consequences make the system stateless and self-healing:

1. **No database.** All domain state lives in Telegram itself: message text plus the
   ledger account's 👍 reactions. The only persisted local artifact is the GramJS
   **session string** — a credential, not ledger state. A restart loses nothing.

2. **The 👍 reaction is the source of truth for counting (Model A).** A message is
   counted iff it currently carries *the ledger account's* 👍 **and** parses to a
   valid amount. The ledger account is the only account that ever places 👍 (that is
   why it is dedicated, not a participant's account), so the mark is always
   trustworthy and every counted expense is visibly marked in the chat.

### Alternatives considered

- **Bot + edit/delete tracking (rejected).** Keep grammY, store message→amount, apply
  `edited_message` updates. Cannot detect deletes; drifts permanently on any delete or
  any >24h outage; no mechanism to self-correct. Fails the hard requirement.
- **Hybrid bot + userbot (rejected).** A BotFather bot for reactions plus a userbot
  for history. Two identities to authenticate and run; no benefit over a single
  ledger account at this scale.
- **Model B, content-as-truth (rejected).** Count any message that parses, ignore
  reactions. Equivalent math, but "counted" is not independently verifiable in the
  chat and a stray/legacy reaction carries no meaning. Model A's visible, authoritative
  mark was preferred.

## Architecture

A single process running as the dedicated ledger account. All Telegram I/O sits behind
a thin interface so the core logic is pure and testable.

### Component changes

**Removed:**
- `db.ts` and the `better-sqlite3` dependency.
- All SQLite logic in `service.ts`.
- DB-based `group_chat_id` discovery (the `meta` table).

**Reused largely as-is:**
- `parser.ts` — amount parsing; rule "first token is a number" unchanged.
- `dates.ts` — timezone-aware month bucketing (`currentBucket`, `previousBucket`,
  `bucketFromUtc`). Year-boundary rollover already handled.
- `format.ts`, `banner.ts` — report text and monthly PNG, unchanged.
- `balance.ts` — `computeBalance` over per-participant sums, unchanged.
- `scheduler.ts` — monthly cron trigger, unchanged.
- `config.ts` — gains MTProto fields (below); keeps the two participant IDs and timezone.

**Rewritten:**
- `bot.ts` → GramJS client: connect, dispatch incoming events, respond to commands.
- `service.ts` → the reconcile engine plus `/to_previous` and balance reporting, all
  sourced from history instead of a DB.

**New dependency:** `telegram` (GramJS). grammY is removed.

### Telegram I/O interface

A small interface isolates all network calls so the reconcile engine is pure logic:

```
interface TelegramGateway {
  fetchHistory(chatId, sinceUnix): Promise<HistoryMessage[]>  // newest-first, paginated internally
  setReaction(chatId, messageId, emoji | none): Promise<void>
  sendMessage(chatId, text): Promise<void>
  sendPhoto(chatId, png, caption): Promise<void>
}
```

`HistoryMessage` carries: `messageId`, `senderId`, `text`, `dateUnix`, and
`hasOurReaction` (derived from the reaction's `chosenOrder` flag, set only for the
current account). The GramJS adapter is the only real implementation; tests inject a
fake.

## The reconcile algorithm (the heart)

### `classify(message)` — pure, the single source of truth for a message's desired state

```
classify(message):
  if senderId is not a participant            → IGNORE            (no reaction)
  if text starts with "/to_previous":
     parse "<amount> <desc>"
        valid   → COUNT, bucket = previousBucket(message.date), amount, desc
        invalid → NOT_EXPENSE                                    (no reaction)
  if first token of text is a number:
     parse amount
        valid   → COUNT, bucket = monthOf(message.date), amount, desc=text
        invalid → NOT_EXPENSE                                    (no reaction)
  else                                         → NOT_EXPENSE      (no reaction)
```

`classify` reads only the message's **current** text and date — never any remembered
history — so it always reflects the present state. The bucket is re-derived from the
message date every time, so an expense edited in a later month still counts toward its
original month.

A `/to_previous` message's first token is `/to_previous`, not a number, so it can never
be double-counted as a regular expense.

### Reconcile pass over a month window

1. **Fetch** chat history for the window via `fetchHistory` (paginated newest-first,
   stop once past the window start). Low volume — at most a few pages.
2. For each message, compare **desired** (`classify`) vs **actual** (`hasOurReaction`):
   - desired = COUNT, actual = no 👍 → **add 👍** (offline post, or number-added edit)
   - desired ≠ COUNT, actual = has 👍 → **revoke 👍** (number edited out)
   - agree → no write
3. **Compute balance** from the COUNT messages, each placed into its bucket by
   `classify`, summed per participant via `computeBalance`.

Because step 3 reads current text and step 2 reconciles the visible 👍 to match, both
the math and the marks self-heal on every pass, regardless of offline duration or
intervening edits/deletes. A deleted message is simply absent from history — its 👍
went with it, nothing to revoke, it stops counting.

### Window selection

- **Current month (`/balance`)** → fetch current month. Count regular expenses bucketed
  to the current month. `/to_previous` sent in the current month buckets to the
  *previous* month, so it is excluded here.
- **Previous month (`/balance_previous`)** → fetch **previous + current** month. Count
  previous-month regular expenses **and** current-month `/to_previous` (which bucket
  back to the previous month).

## Triggers and live behavior

### Reconcile triggers (run the pass, then act)

- **On startup** — catch up on everything missed while offline.
- **On `/balance`** — reconcile current month, reply with the report.
- **On `/balance_previous`** — reconcile previous+current month, reply with the report.
- **Before the monthly banner (cron)** — reconcile the just-ended month, then render
  and post the PNG to `GROUP_CHAT_ID`.
- **On reconnect** — GramJS auto-reconnects; on reconnect, run a startup-style
  reconcile to close any gap during the disconnect.

No periodic timer in v1 (YAGNI). The 👍 on an offline post appears at the next balance
request, reconnect, or startup. A timer can be added later if marks feel laggy.

### Live event handlers (when online, for responsiveness — all delegate to `classify`)

- **New message** from a participant → `classify` → add 👍 if COUNT (instant
  acknowledgment). `/to_previous` → also reply with the confirmation text.
- **Edited message** → `classify` the new text → add or revoke 👍 to match (online
  fast-path; the offline case is covered by reconcile).
- **Command messages** (`/balance`, `/balance_previous`) from a participant → run the
  matching reconcile + reply.

Commands and expenses are accepted **only from the two configured participants**;
everything else is ignored. The ledger account is a plain user, so commands are plain
text starting with `/` — no `@botname` suffix to handle.

## Config, auth, and session

`config.ts` changes:
- **Removed:** `botToken`, `dbPath`.
- **Added:**
  - `apiId` (number), `apiHash` (string) — from https://my.telegram.org.
  - `sessionString` — persisted GramJS `StringSession`, read from `TELEGRAM_SESSION`.
  - `groupChatId` (number) — read from `GROUP_CHAT_ID`; the fixed banner destination
    (replaces DB-based discovery).
- **Kept:** `user1`, `user2`, `timezone`.

**One-time login:** an `npm run login` script prompts for phone + login code (and 2FA
password if set), prints the resulting session string. Paste it into `.env` once;
thereafter the process connects non-interactively. The session string is the single
piece of persisted local state and is a credential — stored in gitignored `.env`,
treated like a password.

## Error handling and edge cases

- **FLOOD_WAIT / rate limits:** catch GramJS `FloodWaitError`, sleep the requested
  duration, retry once. Guards a long offline catch-up from hammering the API; should
  never fire at this volume.
- **Reaction write failures** (message deleted mid-pass, permissions) → log and skip;
  the next pass reconciles. Never fatal.
- **Multiple edits / edit-then-delete while offline:** irrelevant — only the current
  state is ever read, so intermediate history does not matter.
- **Ledger account's own messages** (banners, confirmations): the ledger account is not
  a participant, so `classify` ignores them.
- **Year-boundary `/to_previous`** (January → December of prior year): handled by the
  existing `previousBucket` rollover.
- **Stray manual 👍 risk:** mitigated by using a dedicated account that no human reacts
  from. (Were a participant's account used, a hand-placed 👍 on a numeric message would
  be miscounted — the reason a dedicated account was chosen.)
- **Un-counting an expense:** edit the message to remove its number → `classify`
  returns NOT_EXPENSE → 👍 revoked. Manually removing the 👍 does not stick: reconcile
  re-adds it to any still-valid message.

## Testing

- **Pure functions** (`classify`, `parser`, `dates`, `balance`) — unit-tested with no
  Telegram dependency. The real logic lives here; coverage stays high.
- **Reconcile pass** — tested against a **fake `TelegramGateway`**: feed arrays of fake
  messages (with/without our 👍, valid/invalid/edited text) and assert the resulting
  add-👍 / revoke-👍 / balance decisions. No network.
- **GramJS adapter** — the thin real implementation of `TelegramGateway`; smoke-tested
  manually against the real group during setup, not in CI.

The key testability move: all Telegram I/O sits behind `TelegramGateway`, so the
reconcile engine — the part easiest to get wrong — is tested as pure logic.

## Out of scope (v1)

- Periodic reconcile timer.
- Migrating legacy SQLite data or legacy bot 👍 reactions (different account; fresh
  start).
- Any expense semantics beyond the existing parser rule.
