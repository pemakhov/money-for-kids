# Stateless MTProto Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stateful grammY + SQLite bot with a stateless MTProto (GramJS) ledger account whose balance is recomputed from chat history on demand, using the account's 👍 reaction as the source of truth for which messages count.

**Architecture:** A single process logs into Telegram as a dedicated user account (GramJS). There is no database — all state is message text plus the account's 👍 reactions. A pure `classify()` function decides each message's desired state; a `reconcile` pass re-reads history, reconciles every message's 👍 to match `classify`, and sums the counted ones. All Telegram I/O sits behind a `TelegramGateway` interface so the core logic is tested as pure functions against a fake.

**Tech Stack:** TypeScript (ESM), GramJS (`telegram`), Luxon, node-cron, sharp, Vitest, tsx.

## Global Constraints

- **Module system:** ESM (`"type": "module"`). Relative imports in source use **no file extension** (project uses `moduleResolution: "Bundler"`); follow existing files (e.g. `import { parseAmountCents } from './parser'`).
- **Test runner:** Vitest. Run a single file with `npx vitest run test/<file>.test.ts`. Run all with `npm test`. Typecheck with `npm run typecheck`.
- **Language for all user-facing strings:** Ukrainian, matching existing `format.ts` copy exactly.
- **Money:** integer **cents** everywhere internally; only `format.ts` renders to `₴`.
- **The counted-reaction emoji is `👍`** (U+1F44D), matching the prior bot's mark.
- **No database, no `botToken`.** Do not reintroduce `better-sqlite3` or `grammy`.
- **Participants only:** messages and commands from any sender that is neither `user1.id` nor `user2.id` are fully ignored (no reaction, no reply).
- **Commit after every task** with the exact message shown in the task's final step.

---

## File Structure

**Created:**
- `src/classify.ts` — pure `classify(input, config)`; the single source of truth for a message's desired state.
- `src/gateway.ts` — `TelegramGateway` interface and `HistoryMessage` type. No logic.
- `src/reconcile.ts` — `reconcileBalance()`: fetch a month window, reconcile every 👍, sum the counted messages, return the formatted report.
- `src/handlers.ts` — `onNewMessage()` / `onEditedMessage()`: live event logic delegating to `classify`/`reconcile`/gateway.
- `src/telegram-gramjs.ts` — the GramJS adapter implementing `TelegramGateway`, plus event binding. The only file that imports `telegram`.
- `scripts/login.ts` — one-time interactive login that prints a session string.

**Modified:**
- `src/config.ts` — swap `botToken`/`dbPath` for `apiId`/`apiHash`/`sessionString`/`groupChatId`.
- `src/dates.ts` — add `bucketFromUnix()` and `previousBucketFromUnix()`.
- `src/index.ts` — wire GramJS client + handlers + startup reconcile + monthly banner.
- `package.json` — drop `grammy`/`better-sqlite3`/`@types/better-sqlite3`, add `telegram`, add `login` script.

**Deleted:**
- `src/db.ts`, `src/service.ts`, `src/bot.ts`
- `test/db.test.ts`, `test/service.test.ts`

**Reused unchanged:** `parser.ts`, `balance.ts`, `format.ts`, `banner.ts`, `scheduler.ts`.

---

### Task 1: Config for MTProto

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts` (rewrite)

**Interfaces:**
- Produces: `interface Config { apiId: number; apiHash: string; sessionString: string; groupChatId: number; user1: Participant; user2: Participant; timezone: string }` and `loadConfig(env?): Config`. `Participant` is unchanged (`{ id, nominative, dative }`).
- Env vars consumed: `API_ID` (int), `API_HASH` (string), `TELEGRAM_SESSION` (string), `GROUP_CHAT_ID` (int), `USER1_ID` (int), `USER2_ID` (int), `TIMEZONE` (optional, default `Europe/Kyiv`).

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  API_ID: '12345', API_HASH: 'abcdef', TELEGRAM_SESSION: 'sess',
  GROUP_CHAT_ID: '-1001234567890', USER1_ID: '111', USER2_ID: '222',
  TIMEZONE: 'Europe/Kyiv',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('loads MTProto fields, ids, and fixed Ukrainian names', () => {
    const c = loadConfig(base);
    expect(c.apiId).toBe(12345);
    expect(c.apiHash).toBe('abcdef');
    expect(c.sessionString).toBe('sess');
    expect(c.groupChatId).toBe(-1001234567890);
    expect(c.user1).toEqual({ id: 111, nominative: 'Сергій', dative: 'Сергію' });
    expect(c.user2).toEqual({ id: 222, nominative: 'Марина', dative: 'Марині' });
    expect(c.timezone).toBe('Europe/Kyiv');
  });

  it('defaults timezone when absent', () => {
    const c = loadConfig({ ...base, TIMEZONE: undefined } as NodeJS.ProcessEnv);
    expect(c.timezone).toBe('Europe/Kyiv');
  });

  it('throws when API_ID is missing', () => {
    const { API_ID, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/API_ID/);
  });

  it('throws when GROUP_CHAT_ID is not an integer', () => {
    expect(() => loadConfig({ ...base, GROUP_CHAT_ID: 'xyz' })).toThrow(/GROUP_CHAT_ID/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `loadConfig` still returns `botToken`/`dbPath`; assertions on `apiId` etc. fail.

- [ ] **Step 3: Rewrite `src/config.ts`**

Replace the entire contents:

```ts
export interface Participant {
  id: number;
  nominative: string;
  dative: string;
}

export interface Config {
  apiId: number;
  apiHash: string;
  sessionString: string;
  groupChatId: number;
  user1: Participant;
  user2: Participant;
  timezone: string;
}

const USER1_NAME = { nominative: 'Сергій', dative: 'Сергію' } as const;
const USER2_NAME = { nominative: 'Марина', dative: 'Марині' } as const;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

function requireIntEnv(env: NodeJS.ProcessEnv, key: string): number {
  const raw = requireEnv(env, key);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || String(n) !== raw) {
    throw new Error(`Env var ${key} must be an integer, got: ${raw}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiId: requireIntEnv(env, 'API_ID'),
    apiHash: requireEnv(env, 'API_HASH'),
    sessionString: requireEnv(env, 'TELEGRAM_SESSION'),
    groupChatId: requireIntEnv(env, 'GROUP_CHAT_ID'),
    user1: { id: requireIntEnv(env, 'USER1_ID'), ...USER1_NAME },
    user2: { id: requireIntEnv(env, 'USER2_ID'), ...USER2_NAME },
    timezone: env.TIMEZONE?.trim() || 'Europe/Kyiv',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: MTProto config (apiId/apiHash/session/groupChatId), drop botToken/dbPath"
```

---

### Task 2: Date helpers for message-anchored buckets

**Files:**
- Modify: `src/dates.ts`
- Test: `test/dates.test.ts` (append cases)

**Interfaces:**
- Consumes: existing `MonthBucket`, `toBucket`, Luxon `DateTime`.
- Produces: `bucketFromUnix(unixSeconds: number, timezone: string): MonthBucket` and `previousBucketFromUnix(unixSeconds: number, timezone: string): MonthBucket`. The "previous" variant is relative to the **message's own date**, not `now` — so a `/to_previous` always buckets to the month before it was sent, regardless of when reconcile runs.

- [ ] **Step 1: Add failing tests**

Append to `test/dates.test.ts` (inside the file, after existing tests; keep existing imports and add the new names to the import from `../src/dates`):

```ts
import { bucketFromUnix, previousBucketFromUnix } from '../src/dates';

describe('bucketFromUnix', () => {
  // 10 June 2026 12:00 UTC
  const JUNE = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);
  it('buckets a unix timestamp into its month in the given zone', () => {
    expect(bucketFromUnix(JUNE, 'Europe/Kyiv')).toEqual({ year: 2026, month: 6 });
  });
  it('previousBucketFromUnix returns the month before the message date', () => {
    expect(previousBucketFromUnix(JUNE, 'Europe/Kyiv')).toEqual({ year: 2026, month: 5 });
  });
  it('previousBucketFromUnix rolls the year at January', () => {
    const JAN = Math.floor(Date.UTC(2026, 0, 15, 12, 0, 0) / 1000);
    expect(previousBucketFromUnix(JAN, 'Europe/Kyiv')).toEqual({ year: 2025, month: 12 });
  });
});
```

> If `test/dates.test.ts` already imports from `../src/dates`, merge `bucketFromUnix, previousBucketFromUnix` into that existing import line instead of adding a second import.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/dates.test.ts`
Expected: FAIL — `bucketFromUnix is not a function`.

- [ ] **Step 3: Implement**

Append to `src/dates.ts` (the file already imports `DateTime` and defines `toBucket`):

```ts
export function bucketFromUnix(unixSeconds: number, timezone: string): MonthBucket {
  return toBucket(DateTime.fromSeconds(unixSeconds, { zone: 'utc' }).setZone(timezone));
}

export function previousBucketFromUnix(unixSeconds: number, timezone: string): MonthBucket {
  return toBucket(
    DateTime.fromSeconds(unixSeconds, { zone: 'utc' }).setZone(timezone).minus({ months: 1 }),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/dates.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts test/dates.test.ts
git commit -m "feat: message-anchored bucket helpers (bucketFromUnix, previousBucketFromUnix)"
```

---

### Task 3: `classify` — the pure decision function

**Files:**
- Create: `src/classify.ts`
- Test: `test/classify.test.ts`

**Interfaces:**
- Consumes: `parseAmountCents` (`./parser`), `bucketFromUnix`/`previousBucketFromUnix` (`./dates`), `Config`/`Participant` (`./config`), `MonthBucket` (`./dates`).
- Produces:
  ```ts
  interface ClassifyInput { senderId: number; text: string; dateUnix: number }
  type Classification =
    | { kind: 'ignore' }
    | { kind: 'not_expense' }
    | { kind: 'count'; participant: Participant; amountCents: number;
        bucket: MonthBucket; source: 'message' | 'to_previous'; description: string };
  function classify(input: ClassifyInput, config: Config): Classification
  ```
  Rules: non-participant → `ignore`. Text starting with `/to_previous` → parse the remainder; valid amount → `count` with `source:'to_previous'` and `bucket = previousBucketFromUnix(dateUnix)`, else `not_expense`. Otherwise, leading-number text → `count` with `source:'message'` and `bucket = bucketFromUnix(dateUnix)`, else `not_expense`.

- [ ] **Step 1: Write the failing test**

Create `test/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classify } from '../src/classify';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};
// 10 June 2026 12:00 UTC
const JUNE = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);

describe('classify', () => {
  it('ignores non-participants', () => {
    expect(classify({ senderId: 999, text: '100', dateUnix: JUNE }, config)).toEqual({ kind: 'ignore' });
  });

  it('counts a leading-number message into the message month', () => {
    const c = classify({ senderId: 1, text: '4000 грн', dateUnix: JUNE }, config);
    expect(c).toMatchObject({
      kind: 'count', amountCents: 400000, source: 'message',
      bucket: { year: 2026, month: 6 }, description: '4000 грн',
    });
    expect(c.kind === 'count' && c.participant.id).toBe(1);
  });

  it('marks a participant message without a leading number as not_expense', () => {
    expect(classify({ senderId: 1, text: 'купив зошити', dateUnix: JUNE }, config))
      .toEqual({ kind: 'not_expense' });
  });

  it('counts /to_previous into the previous month with the remainder as description', () => {
    const c = classify({ senderId: 2, text: '/to_previous 300 Максу на бутерброд', dateUnix: JUNE }, config);
    expect(c).toMatchObject({
      kind: 'count', amountCents: 30000, source: 'to_previous',
      bucket: { year: 2026, month: 5 }, description: '300 Максу на бутерброд',
    });
  });

  it('marks /to_previous without an amount as not_expense', () => {
    expect(classify({ senderId: 2, text: '/to_previous просто текст', dateUnix: JUNE }, config))
      .toEqual({ kind: 'not_expense' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/classify.test.ts`
Expected: FAIL — cannot find module `../src/classify`.

- [ ] **Step 3: Implement `src/classify.ts`**

```ts
import { parseAmountCents } from './parser';
import { bucketFromUnix, previousBucketFromUnix } from './dates';
import type { MonthBucket } from './dates';
import type { Config, Participant } from './config';

export interface ClassifyInput {
  senderId: number;
  text: string;
  dateUnix: number;
}

export type Classification =
  | { kind: 'ignore' }
  | { kind: 'not_expense' }
  | {
      kind: 'count';
      participant: Participant;
      amountCents: number;
      bucket: MonthBucket;
      source: 'message' | 'to_previous';
      description: string;
    };

const TO_PREVIOUS = /^\/to_previous\b/;

function participantFor(config: Config, senderId: number): Participant | null {
  if (senderId === config.user1.id) return config.user1;
  if (senderId === config.user2.id) return config.user2;
  return null;
}

export function classify(input: ClassifyInput, config: Config): Classification {
  const participant = participantFor(config, input.senderId);
  if (!participant) return { kind: 'ignore' };

  const text = input.text.trim();

  if (TO_PREVIOUS.test(text)) {
    const remainder = text.replace(TO_PREVIOUS, '').trim();
    const amountCents = parseAmountCents(remainder);
    if (amountCents === null) return { kind: 'not_expense' };
    return {
      kind: 'count', participant, amountCents,
      bucket: previousBucketFromUnix(input.dateUnix, config.timezone),
      source: 'to_previous', description: remainder,
    };
  }

  const amountCents = parseAmountCents(text);
  if (amountCents === null) return { kind: 'not_expense' };
  return {
    kind: 'count', participant, amountCents,
    bucket: bucketFromUnix(input.dateUnix, config.timezone),
    source: 'message', description: text,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/classify.ts test/classify.test.ts
git commit -m "feat: pure classify() deciding each message's counted state and bucket"
```

---

### Task 4: `reconcile` — fetch window, heal 👍, sum the balance

**Files:**
- Create: `src/gateway.ts`
- Create: `src/reconcile.ts`
- Test: `test/reconcile.test.ts`

**Interfaces:**
- Consumes: `classify`/`Classification` (`./classify`), `computeBalance` (`./balance`), `formatBalance` (`./format`), `currentBucket`/`previousBucket` (`./dates`), `MonthBucket` (`./dates`), `Config` (`./config`), Luxon `DateTime`.
- Produces (`src/gateway.ts`):
  ```ts
  interface HistoryMessage { messageId: number; senderId: number; text: string; dateUnix: number; hasOurReaction: boolean }
  interface TelegramGateway {
    fetchHistory(chatId: number, sinceUnix: number): Promise<HistoryMessage[]>;
    setReaction(chatId: number, messageId: number, emoji: string | null): Promise<void>;
    sendMessage(chatId: number, text: string): Promise<void>;
    sendPhoto(chatId: number, png: Buffer, filename: string): Promise<void>;
  }
  ```
- Produces (`src/reconcile.ts`): `THUMBS_UP = '👍'` (exported const) and `reconcileBalance(gateway: TelegramGateway, config: Config, chatId: number, which: 'current' | 'previous'): Promise<string>`. It fetches from the start of the relevant month (current → start of current; previous → start of previous, which also covers current-month `/to_previous`), adds 👍 to every `count` message lacking it, revokes 👍 from every non-`count` message carrying it, and returns the formatted report for the target bucket.

- [ ] **Step 1: Create the gateway interface (no test of its own)**

Create `src/gateway.ts`:

```ts
export interface HistoryMessage {
  messageId: number;
  senderId: number;
  text: string;
  dateUnix: number;
  hasOurReaction: boolean;
}

export interface TelegramGateway {
  fetchHistory(chatId: number, sinceUnix: number): Promise<HistoryMessage[]>;
  setReaction(chatId: number, messageId: number, emoji: string | null): Promise<void>;
  sendMessage(chatId: number, text: string): Promise<void>;
  sendPhoto(chatId: number, png: Buffer, filename: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileBalance, THUMBS_UP } from '../src/reconcile';
import type { TelegramGateway, HistoryMessage } from '../src/gateway';
import { currentBucket, previousBucket } from '../src/dates';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};

interface ReactionCall { messageId: number; emoji: string | null }

function fakeGateway(messages: HistoryMessage[]) {
  const reactions: ReactionCall[] = [];
  const sent: string[] = [];
  const gateway: TelegramGateway = {
    async fetchHistory() { return messages; },
    async setReaction(_chatId, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage(_chatId, text) { sent.push(text); },
    async sendPhoto() {},
  };
  return { gateway, reactions, sent };
}

// A unix timestamp inside the given bucket (15th, noon UTC).
function unixIn(bucket: { year: number; month: number }): number {
  return Math.floor(Date.UTC(bucket.year, bucket.month - 1, 15, 12, 0, 0) / 1000);
}

describe('reconcileBalance', () => {
  it('sums counted current-month messages and reports compensation', async () => {
    const cur = currentBucket(config.timezone);
    const t = unixIn(cur);
    const { gateway } = fakeGateway([
      { messageId: 10, senderId: 1, text: '4000 грн', dateUnix: t, hasOurReaction: true },
      { messageId: 11, senderId: 2, text: '1000 грн', dateUnix: t, hasOurReaction: true },
    ]);
    const report = await reconcileBalance(gateway, config, -100, 'current');
    expect(report).toContain('Сергій: 4000 ₴');
    expect(report).toContain('Марина: 1000 ₴');
    expect(report).toContain('Марина має компенсувати Сергію: 1500 ₴');
  });

  it('adds 👍 to a counted message that lacks it', async () => {
    const cur = currentBucket(config.timezone);
    const { gateway, reactions } = fakeGateway([
      { messageId: 20, senderId: 1, text: '500', dateUnix: unixIn(cur), hasOurReaction: false },
    ]);
    await reconcileBalance(gateway, config, -100, 'current');
    expect(reactions).toContainEqual({ messageId: 20, emoji: THUMBS_UP });
  });

  it('revokes 👍 from a message that no longer parses', async () => {
    const cur = currentBucket(config.timezone);
    const { gateway, reactions } = fakeGateway([
      { messageId: 30, senderId: 1, text: 'lunch', dateUnix: unixIn(cur), hasOurReaction: true },
    ]);
    await reconcileBalance(gateway, config, -100, 'current');
    expect(reactions).toContainEqual({ messageId: 30, emoji: null });
  });

  it('does not write a reaction when desired and actual already agree', async () => {
    const cur = currentBucket(config.timezone);
    const { gateway, reactions } = fakeGateway([
      { messageId: 40, senderId: 1, text: '500', dateUnix: unixIn(cur), hasOurReaction: true },
      { messageId: 41, senderId: 1, text: 'note', dateUnix: unixIn(cur), hasOurReaction: false },
    ]);
    await reconcileBalance(gateway, config, -100, 'current');
    expect(reactions).toEqual([]);
  });

  it('counts a current-month /to_previous toward the previous month balance', async () => {
    const cur = currentBucket(config.timezone);
    const prev = previousBucket(config.timezone);
    const { gateway } = fakeGateway([
      // regular expense physically in the previous month
      { messageId: 50, senderId: 1, text: '200', dateUnix: unixIn(prev), hasOurReaction: true },
      // /to_previous sent this month, buckets back to previous
      { messageId: 51, senderId: 2, text: '/to_previous 200 x', dateUnix: unixIn(cur), hasOurReaction: true },
    ]);
    const report = await reconcileBalance(gateway, config, -100, 'previous');
    expect(report).toContain('Сергій: 200 ₴');
    expect(report).toContain('Марина: 200 ₴');
    expect(report).toContain('Витрати порівну, компенсація не потрібна.');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/reconcile.test.ts`
Expected: FAIL — cannot find module `../src/reconcile`.

- [ ] **Step 4: Implement `src/reconcile.ts`**

```ts
import { DateTime } from 'luxon';
import type { TelegramGateway } from './gateway';
import type { Config } from './config';
import type { MonthBucket } from './dates';
import { currentBucket, previousBucket } from './dates';
import { classify } from './classify';
import { computeBalance } from './balance';
import { formatBalance } from './format';

export const THUMBS_UP = '👍';

function startOfBucketUnix(bucket: MonthBucket, timezone: string): number {
  const dt = DateTime.fromObject(
    { year: bucket.year, month: bucket.month, day: 1 },
    { zone: timezone },
  ).startOf('day');
  return Math.floor(dt.toSeconds());
}

function sameBucket(a: MonthBucket, b: MonthBucket): boolean {
  return a.year === b.year && a.month === b.month;
}

export async function reconcileBalance(
  gateway: TelegramGateway,
  config: Config,
  chatId: number,
  which: 'current' | 'previous',
): Promise<string> {
  const target = which === 'current'
    ? currentBucket(config.timezone)
    : previousBucket(config.timezone);
  const sinceUnix = startOfBucketUnix(target, config.timezone);

  const messages = await gateway.fetchHistory(chatId, sinceUnix);

  const rows: { userId: number; amountCents: number }[] = [];
  for (const m of messages) {
    const c = classify(
      { senderId: m.senderId, text: m.text, dateUnix: m.dateUnix },
      config,
    );
    const desired = c.kind === 'count';
    if (desired && !m.hasOurReaction) {
      await gateway.setReaction(chatId, m.messageId, THUMBS_UP);
    } else if (!desired && m.hasOurReaction) {
      await gateway.setReaction(chatId, m.messageId, null);
    }
    if (c.kind === 'count' && sameBucket(c.bucket, target)) {
      rows.push({ userId: c.participant.id, amountCents: c.amountCents });
    }
  }

  const balance = computeBalance(config.user1.id, config.user2.id, rows);
  return formatBalance(target, config.user1, config.user2, balance);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/reconcile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/gateway.ts src/reconcile.ts test/reconcile.test.ts
git commit -m "feat: reconcile pass — heal 👍 from history and sum the balance"
```

---

### Task 5: Live event handlers

**Files:**
- Create: `src/handlers.ts`
- Test: `test/handlers.test.ts`

**Interfaces:**
- Consumes: `classify` (`./classify`), `reconcileBalance`/`THUMBS_UP` (`./reconcile`), `TelegramGateway` (`./gateway`), `formatToPreviousConfirmation` (`./format`), `Config` (`./config`).
- Produces:
  ```ts
  interface IncomingEvent { senderId: number; messageId: number; text: string; dateUnix: number }
  function onNewMessage(gateway: TelegramGateway, config: Config, chatId: number, ev: IncomingEvent): Promise<void>
  function onEditedMessage(gateway: TelegramGateway, config: Config, chatId: number, ev: IncomingEvent): Promise<void>
  ```
  `onNewMessage`: if the text is `/balance` or `/balance_previous` from a participant → reconcile that window and `sendMessage` the report. Otherwise `classify`: on `count` → `setReaction(👍)`, and if `source==='to_previous'` also `sendMessage` the confirmation. A `/to_previous` from a participant that does not parse → `sendMessage` the usage help. Non-participant or plain `not_expense` → nothing.
  `onEditedMessage`: `classify` the new text; `setReaction(👍)` if `count`, else `setReaction(null)`.

- [ ] **Step 1: Write the failing test**

Create `test/handlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { onNewMessage, onEditedMessage } from '../src/handlers';
import { THUMBS_UP } from '../src/reconcile';
import type { TelegramGateway, HistoryMessage } from '../src/gateway';
import { currentBucket } from '../src/dates';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};
const t = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);

function fake(history: HistoryMessage[] = []) {
  const reactions: { messageId: number; emoji: string | null }[] = [];
  const sent: string[] = [];
  const gateway: TelegramGateway = {
    async fetchHistory() { return history; },
    async setReaction(_c, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage(_c, text) { sent.push(text); },
    async sendPhoto() {},
  };
  return { gateway, reactions, sent };
}

describe('onNewMessage', () => {
  it('reacts 👍 to a participant expense', async () => {
    const { gateway, reactions } = fake();
    await onNewMessage(gateway, config, -100, { senderId: 1, messageId: 7, text: '500', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 7, emoji: THUMBS_UP });
  });

  it('ignores a non-participant', async () => {
    const { gateway, reactions, sent } = fake();
    await onNewMessage(gateway, config, -100, { senderId: 999, messageId: 8, text: '500', dateUnix: t });
    expect(reactions).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('reacts and confirms a valid /to_previous', async () => {
    const { gateway, reactions, sent } = fake();
    await onNewMessage(gateway, config, -100, { senderId: 1, messageId: 9, text: '/to_previous 300 x', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 9, emoji: THUMBS_UP });
    expect(sent.some((s) => s.includes('Зараховано'))).toBe(true);
  });

  it('replies with usage help for a /to_previous without amount', async () => {
    const { gateway, reactions, sent } = fake();
    await onNewMessage(gateway, config, -100, { senderId: 1, messageId: 10, text: '/to_previous oops', dateUnix: t });
    expect(reactions).toEqual([]);
    expect(sent.some((s) => s.includes('/to_previous'))).toBe(true);
  });

  it('replies to /balance with a reconciled report', async () => {
    const cur = currentBucket(config.timezone);
    const curT = Math.floor(Date.UTC(cur.year, cur.month - 1, 15, 12, 0, 0) / 1000);
    const { gateway, sent } = fake([
      { messageId: 1, senderId: 1, text: '4000', dateUnix: curT, hasOurReaction: true },
    ]);
    await onNewMessage(gateway, config, -100, { senderId: 1, messageId: 11, text: '/balance', dateUnix: curT });
    expect(sent.some((s) => s.includes('Сергій: 4000 ₴'))).toBe(true);
  });
});

describe('onEditedMessage', () => {
  it('revokes 👍 when an edit removes the number', async () => {
    const { gateway, reactions } = fake();
    await onEditedMessage(gateway, config, -100, { senderId: 1, messageId: 12, text: 'lunch', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 12, emoji: null });
  });

  it('adds 👍 when an edit introduces a number', async () => {
    const { gateway, reactions } = fake();
    await onEditedMessage(gateway, config, -100, { senderId: 1, messageId: 13, text: '250 lunch', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 13, emoji: THUMBS_UP });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/handlers.test.ts`
Expected: FAIL — cannot find module `../src/handlers`.

- [ ] **Step 3: Implement `src/handlers.ts`**

```ts
import type { TelegramGateway } from './gateway';
import type { Config } from './config';
import { classify } from './classify';
import { reconcileBalance, THUMBS_UP } from './reconcile';
import { formatToPreviousConfirmation } from './format';

export interface IncomingEvent {
  senderId: number;
  messageId: number;
  text: string;
  dateUnix: number;
}

const TO_PREVIOUS_USAGE =
  'Використання: /to_previous <сума> <опис>\nНаприклад: /to_previous 300 Максу на бутерброд';

function isParticipant(config: Config, senderId: number): boolean {
  return senderId === config.user1.id || senderId === config.user2.id;
}

export async function onNewMessage(
  gateway: TelegramGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;

  const text = ev.text.trim();
  if (text === '/balance') {
    const report = await reconcileBalance(gateway, config, chatId, 'current');
    await gateway.sendMessage(chatId, report);
    return;
  }
  if (text === '/balance_previous') {
    const report = await reconcileBalance(gateway, config, chatId, 'previous');
    await gateway.sendMessage(chatId, report);
    return;
  }

  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  if (c.kind === 'count') {
    await gateway.setReaction(chatId, ev.messageId, THUMBS_UP);
    if (c.source === 'to_previous') {
      await gateway.sendMessage(chatId, formatToPreviousConfirmation(c.bucket.month, c.amountCents));
    }
    return;
  }
  // Invalid /to_previous from a participant gets usage help; everything else is silent.
  if (c.kind === 'not_expense' && /^\/to_previous\b/.test(text)) {
    await gateway.sendMessage(chatId, TO_PREVIOUS_USAGE);
  }
}

export async function onEditedMessage(
  gateway: TelegramGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;
  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  await gateway.setReaction(chatId, ev.messageId, c.kind === 'count' ? THUMBS_UP : null);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/handlers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/handlers.ts test/handlers.test.ts
git commit -m "feat: live new-message and edited-message handlers"
```

---

### Task 6: GramJS adapter and dependency swap

**Files:**
- Create: `src/telegram-gramjs.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `telegram` (GramJS), `TelegramGateway`/`HistoryMessage` (`./gateway`), `Config` (`./config`).
- Produces: `createGateway(config: Config): Promise<{ gateway: TelegramGateway; client: TelegramClient; onUpdate(handler: (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>): void }>`. The adapter resolves `config.groupChatId` to an input peer, implements all four `TelegramGateway` methods, and translates GramJS new/edited message updates into `IncomingEvent` objects (importing `IncomingEvent` from `./handlers`).

> This task has **no unit test** — it is the thin real-I/O boundary, verified manually in Task 8. Keep all GramJS-specific code confined to this file. The deliverable is a typechecking adapter plus the dependency swap.

- [ ] **Step 1: Swap dependencies**

Run:

```bash
npm uninstall grammy better-sqlite3 @types/better-sqlite3
npm install telegram
```

Expected: `package.json` no longer lists `grammy`, `better-sqlite3`, `@types/better-sqlite3`; it now lists `telegram` under dependencies.

- [ ] **Step 2: Implement `src/telegram-gramjs.ts`**

```ts
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { TelegramGateway, HistoryMessage } from './gateway';
import type { Config } from './config';
import type { IncomingEvent } from './handlers';

type UpdateHandler = (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>;

function senderIdOf(message: Api.Message): number {
  // Private/group messages: fromId is a PeerUser.
  const from = message.fromId;
  if (from instanceof Api.PeerUser) return Number(from.userId);
  return 0; // anonymous/channel posts are not participants
}

function hasOurReaction(message: Api.Message, thumbsUp: string): boolean {
  const reactions = message.reactions;
  if (!reactions || !reactions.results) return false;
  return reactions.results.some(
    (r) =>
      r.chosenOrder !== undefined &&
      r.chosenOrder !== null &&
      r.reaction instanceof Api.ReactionEmoji &&
      r.reaction.emoticon === thumbsUp,
  );
}

const THUMBS_UP = '👍';

export async function createGateway(config: Config): Promise<{
  gateway: TelegramGateway;
  client: TelegramClient;
  onUpdate(handler: UpdateHandler): void;
}> {
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.connect();

  const peer = await client.getInputEntity(config.groupChatId);

  const gateway: TelegramGateway = {
    async fetchHistory(_chatId, sinceUnix) {
      const out: HistoryMessage[] = [];
      for await (const m of client.iterMessages(peer, { limit: 1000 })) {
        if (typeof m.date === 'number' && m.date < sinceUnix) break;
        if (!(m instanceof Api.Message)) continue;
        out.push({
          messageId: m.id,
          senderId: senderIdOf(m),
          text: m.message ?? '',
          dateUnix: m.date,
          hasOurReaction: hasOurReaction(m, THUMBS_UP),
        });
      }
      return out;
    },
    async setReaction(_chatId, messageId, emoji) {
      await client.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: messageId,
          reaction: emoji ? [new Api.ReactionEmoji({ emoticon: emoji })] : [],
        }),
      );
    },
    async sendMessage(_chatId, text) {
      await client.sendMessage(peer, { message: text });
    },
    async sendPhoto(_chatId, png, filename) {
      await client.sendFile(peer, { file: new (await import('telegram')).CustomFile(filename, png.length, '', png) });
    },
  };

  function onUpdate(handler: UpdateHandler): void {
    client.addEventHandler(async (update: Api.TypeUpdate) => {
      const isNew = update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage;
      const isEdit = update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage;
      if (!isNew && !isEdit) return;
      const message = (update as { message: Api.TypeMessage }).message;
      if (!(message instanceof Api.Message)) return;
      const ev: IncomingEvent = {
        senderId: senderIdOf(message),
        messageId: message.id,
        text: message.message ?? '',
        dateUnix: message.date,
      };
      await handler(isNew ? 'new' : 'edit', ev);
    });
  }

  return { gateway, client, onUpdate };
}
```

> **Implementer note:** GramJS surface area is broad; the names above (`iterMessages`, `Api.messages.SendReaction`, `Api.ReactionEmoji`, `chosenOrder`, `CustomFile`, the update classes) are the intended ones, but verify each against the installed `telegram` version's typings while implementing. The contract that matters is the `TelegramGateway` shape and the `'new' | 'edit'` + `IncomingEvent` callback — keep those exact so Tasks 4/5 stay correct. Confine any version-specific adjustments to this file.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). Fix any GramJS typing mismatches here only.

- [ ] **Step 4: Commit**

```bash
git add src/telegram-gramjs.ts package.json package-lock.json
git commit -m "feat: GramJS adapter implementing TelegramGateway; swap grammy/sqlite for telegram"
```

---

### Task 7: One-time login script

**Files:**
- Create: `scripts/login.ts`
- Modify: `package.json` (add `login` script)

**Interfaces:**
- Consumes: `telegram` (GramJS), Node `readline/promises`. Reads `API_ID`/`API_HASH` directly from `process.env` (not `loadConfig`, which requires a session that does not exist yet).
- Produces: prints a session string to stdout for pasting into `.env` as `TELEGRAM_SESSION`.

- [ ] **Step 1: Implement `scripts/login.ts`**

```ts
import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { createInterface } from 'node:readline/promises';

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.API_ID ?? '', 10);
  const apiHash = process.env.API_HASH ?? '';
  if (!Number.isInteger(apiId) || apiHash === '') {
    throw new Error('Set API_ID and API_HASH in .env before running login.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => rl.question('Phone number (with country code): '),
    password: async () => rl.question('2FA password (blank if none): '),
    phoneCode: async () => rl.question('Login code from Telegram: '),
    onError: (err) => console.error(err),
  });

  console.log('\nTELEGRAM_SESSION=' + (client.session.save() as unknown as string));
  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `login` script to `package.json`**

In the `"scripts"` block, add:

```json
    "login": "tsx scripts/login.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

> The interactive login itself is run manually by the user once they have real credentials; it is not part of automated verification.

- [ ] **Step 4: Commit**

```bash
git add scripts/login.ts package.json
git commit -m "feat: one-time MTProto login script printing a session string"
```

---

### Task 8: Entrypoint wiring and removal of dead modules

**Files:**
- Modify: `src/index.ts` (rewrite)
- Delete: `src/db.ts`, `src/service.ts`, `src/bot.ts`, `test/db.test.ts`, `test/service.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (`./config`), `createGateway` (`./telegram-gramjs`), `onNewMessage`/`onEditedMessage` (`./handlers`), `reconcileBalance` (`./reconcile`), `scheduleMonthlyBanner` (`./scheduler`), `renderMonthBanner` (`./banner`), `currentBucket` (`./dates`), `monthNameUpper` (`./format`).
- Produces: the running process. On startup it connects, runs a `'previous'` reconcile (settling 👍 across the previous+current window after any downtime), registers live handlers, and schedules the monthly banner.

- [ ] **Step 1: Delete the dead modules and their tests**

Run:

```bash
git rm src/db.ts src/service.ts src/bot.ts test/db.test.ts test/service.test.ts
```

- [ ] **Step 2: Rewrite `src/index.ts`**

```ts
import 'dotenv/config';
import { loadConfig } from './config';
import { createGateway } from './telegram-gramjs';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { previousBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const { gateway, onUpdate } = await createGateway(config);
  const chatId = config.groupChatId;

  // Catch up on anything missed while offline (settles previous + current month).
  await reconcileBalance(gateway, config, chatId, 'previous');

  onUpdate(async (kind, ev) => {
    try {
      if (kind === 'new') await onNewMessage(gateway, config, chatId, ev);
      else await onEditedMessage(gateway, config, chatId, ev);
    } catch (err) {
      console.error('Update handler failed:', err);
    }
  });

  scheduleMonthlyBanner(config.timezone, async () => {
    // Settle the just-ended month, then post its banner.
    const bucket = previousBucket(config.timezone);
    await reconcileBalance(gateway, config, chatId, 'previous');
    try {
      const png = await renderMonthBanner(bucket.month, bucket.year);
      await gateway.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
    } catch (err) {
      console.error('Banner render/send failed; sending text fallback:', err);
      try {
        await gateway.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
      } catch (fallbackErr) {
        console.error('Banner text fallback also failed:', fallbackErr);
      }
    }
  });

  console.log('Ledger account started.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck PASS; all tests PASS (`config`, `dates`, `classify`, `reconcile`, `handlers`, `parser`, `format`, `balance`, `banner`, `scheduler`, `smoke`). No references to the deleted `db`/`service`/`bot` modules remain.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: GramJS entrypoint with startup reconcile and monthly banner; remove DB/service/bot"
```

---

### Task 9: README and .env documentation

**Files:**
- Modify: `README.md`
- Create: `.env.example`

**Interfaces:** none (documentation only). Folded in as its own task because the env-var surface changed completely (no `BOT_TOKEN`/`DB_PATH`; new `API_ID`/`API_HASH`/`TELEGRAM_SESSION`/`GROUP_CHAT_ID`) and the setup flow now requires the one-time login.

- [ ] **Step 1: Create `.env.example`**

```
# From https://my.telegram.org → API development tools
API_ID=
API_HASH=
# Produced by `npm run login` (paste the printed value here)
TELEGRAM_SESSION=
# The numeric id of the family group (e.g. -1001234567890)
GROUP_CHAT_ID=
# Telegram user ids of the two participants
USER1_ID=
USER2_ID=
# Optional, defaults to Europe/Kyiv
TIMEZONE=Europe/Kyiv
```

- [ ] **Step 2: Update `README.md`**

Read the current `README.md`. Replace any setup section that references `BOT_TOKEN`, `DB_PATH`, `@BotFather`, or SQLite with the new flow:
1. Create a dedicated Telegram account and add it to the family group.
2. Get `API_ID`/`API_HASH` from https://my.telegram.org.
3. Fill `.env` from `.env.example`.
4. Run `npm run login` once and paste the printed `TELEGRAM_SESSION` into `.env`.
5. Run `npm start`.

Also update any "how it works" description to: balance is recomputed from chat history on demand; the dedicated account's 👍 marks counted messages; edits and deletes are reconciled by re-reading history (no database).

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rniE 'BOT_TOKEN|botfather|sqlite|DB_PATH|grammy' README.md .env.example`
Expected: no matches (exit code 1, no output).

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: MTProto setup, login flow, and stateless model in README/.env.example"
```

---

## Self-Review

**Spec coverage:**
- Stateless, no DB → Tasks 4/8 (no `db.ts`; state from history + reactions). ✅
- MTProto user account / GramJS → Task 6 adapter, Task 7 login. ✅
- Model A, 👍 as source of truth → `reconcileBalance` reaction diff (Task 4); `hasOurReaction` via `chosenOrder` (Task 6). ✅
- `classify` single source of truth, message-anchored buckets → Tasks 2/3. ✅
- Window selection (current vs previous+current) → `reconcileBalance` `sinceUnix` logic + tests (Task 4). ✅
- Reconcile triggers: startup, `/balance`, `/balance_previous`, before banner → Tasks 5/8. ✅ (Reconnect auto-reconcile is **not** separately implemented beyond GramJS auto-reconnect; startup reconcile covers process restarts. Periodic timer intentionally out of scope.)
- Live handlers (new/edit) → Task 5. ✅
- Config/auth/session → Tasks 1/7; `GROUP_CHAT_ID` replaces DB discovery. ✅
- Error handling: FLOOD_WAIT/reaction-failure tolerance → handler `try/catch` in Task 8 wraps update processing; **per-call FloodWait backoff is not implemented in v1** (volume is two people) — noted here as a deliberate simplification rather than a silent gap. Reaction write failures inside a reconcile pass will currently reject the pass; acceptable because the next trigger retries.
- Testing: pure-function + fake-gateway coverage → Tasks 1–5; manual smoke → Tasks 6–8. ✅
- TegramGateway isolates I/O → Task 4 interface, Task 6 sole implementation. ✅

**Note on a spec/plan divergence (intentional):** the spec described an explicit FloodWait sleep-and-retry and an explicit reconnect reconcile. The plan implements the robust-enough subset for a two-person tool (try/catch around updates; startup reconcile) and flags the rest as out of scope so the implementer doesn't treat their absence as a bug. If stronger resilience is wanted, add a retry wrapper inside `src/telegram-gramjs.ts` only — the gateway boundary keeps it out of the tested core.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one explicitly non-automated boundary (GramJS adapter, interactive login) is called out with manual verification, not left vague.

**Type consistency:** `Config` shape identical across Tasks 1/3/4/5; `Classification`/`classify` signature identical in Tasks 3/4/5; `TelegramGateway`/`HistoryMessage` identical in Tasks 4/5/6; `IncomingEvent` defined in Task 5, imported by Task 6; `THUMBS_UP` exported from `reconcile.ts` and reused by handlers/tests; `reconcileBalance` signature identical in Tasks 4/5/8.
