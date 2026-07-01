# Bot / MTProto Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the ledger into a grammy **bot** (native commands, bot-owned 👍 reactions, monthly banner) and a **silent MTProto** history reader, with the balance keyed on the bot's reaction instead of the MTProto account's.

**Architecture:** One Node process holds two clients behind two seams. `HistoryGateway` (gramjs/MTProto) does read-only history fetch. `BotGateway` (grammy) sets reactions and sends messages/photos. The bot receives live message/edit updates and owns all writes; MTProto only reads. Reaction detection changes from "the MTProto account's own reaction" (`chosenOrder`) to "the bot's peer appears in `recentReactions`". The bot's user id is derived from `getMe()` at boot and passed into the history gateway so it can recognise the bot's 👍.

**Tech Stack:** TypeScript (strict, ESM), gramjs (`telegram`) for MTProto, **grammy** for the Bot API, luxon, node-cron, sharp, vitest.

## Global Constraints

- **Group is a supergroup.** `GROUP_CHAT_ID=-1004386306971` (migration already done). Bot and MTProto share one global message-id space — this whole design depends on it.
- **Bot must be a group admin with privacy mode disabled**, or it won't see plain expense messages. Operational prerequisite, not code.
- **`BOT_USER_ID` is derived at runtime** from `bot.botInfo.id` (grammy `getMe`), never hard-coded or read from env.
- **Reaction detection rule:** a message counts iff `reactions.recentReactions` contains `{ peerId is PeerUser with userId === BOT_USER_ID, reaction is ReactionEmoji with emoticon === '👍' }`. `chosenOrder` must NOT be used.
- **`THUMBS_UP = '👍'`** stays the single source in `src/reconcile.ts`.
- **Strict typing, no `any`.** Untyped boundaries are a defect.
- **Comments: WHY only.** No TODO/HACK/FIXME, no section banners, no restating code.
- **Naming:** kebab-case files, camelCase functions/vars, UPPER_SNAKE_CASE constants. Intent-revealing names.
- **Ukrainian user-facing copy is fixed** — copy strings verbatim, do not translate or reword.
- **Refactor-green convention:** this is one interconnected refactor, so Tasks 2–5 are each verified by running **their own targeted test file** (vitest compiles only the imported subgraph). Full-tree `npm run typecheck` and the complete `npm test` suite go green only at Task 6. Do not expect a clean full typecheck mid-refactor.

---

### Task 1: Add grammy dependency and `BOT_TOKEN` config

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Config` gains `botToken: string`. Loaded from required env `BOT_TOKEN`.

- [ ] **Step 1: Install grammy**

Run:
```bash
npm install grammy
```
Expected: `package.json` dependencies now include `"grammy"`, install succeeds.

- [ ] **Step 2: Update the failing config test**

In `test/config.test.ts`, add `BOT_TOKEN` to the `base` fixture and assert it loads, plus a missing-token throw test. Replace the `base` constant and add assertions:

```typescript
const base = {
  API_ID: '12345', API_HASH: 'abcdef', TELEGRAM_SESSION: 'sess',
  GROUP_CHAT_ID: '-1001234567890', USER1_ID: '111', USER2_ID: '222',
  TIMEZONE: 'Europe/Kyiv', BOT_TOKEN: 'bottoken',
} as NodeJS.ProcessEnv;
```

Inside the first test (`loads MTProto fields, ids, and fixed Ukrainian names`), add:

```typescript
    expect(c.botToken).toBe('bottoken');
```

Add a new test after the `API_ID` throw test:

```typescript
  it('throws when BOT_TOKEN is missing', () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/BOT_TOKEN/);
  });
```

- [ ] **Step 3: Run the config test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — `c.botToken` is `undefined`, `BOT_TOKEN` throw test fails.

- [ ] **Step 4: Add `botToken` to `Config` and `loadConfig`**

In `src/config.ts`, add the field to the interface (after `sessionString`):

```typescript
  sessionString: string;
  botToken: string;
```

And load it in `loadConfig` (after the `sessionString` line):

```typescript
    sessionString: requireEnv(env, 'TELEGRAM_SESSION'),
    botToken: requireEnv(env, 'BOT_TOKEN'),
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `npm test -- config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config.ts test/config.test.ts
git commit -m "feat: add grammy dep and BOT_TOKEN config"
```

---

### Task 2: Split the gateway into `HistoryGateway` + `BotGateway`, refactor reconcile

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/reconcile.ts`
- Test: `test/reconcile.test.ts`

**Interfaces:**
- Consumes: `Config` (with `botToken`).
- Produces:
  - `HistoryMessage` field renamed `hasOurReaction` → `hasBotReaction: boolean`.
  - `interface HistoryGateway { fetchHistory(chatId: number, sinceUnix: number): Promise<HistoryMessage[]> }`
  - `interface BotGateway { setReaction(chatId, messageId, emoji: string | null): Promise<void>; sendMessage(chatId, text): Promise<void>; sendPhoto(chatId, png: Buffer, filename): Promise<void> }`
  - `reconcileBalance(history: HistoryGateway, bot: BotGateway, config: Config, chatId: number, which: 'current' | 'previous'): Promise<string>`
  - `TelegramGateway` is removed.

- [ ] **Step 1: Rewrite the reconcile test for the two-gateway shape**

Replace the top of `test/reconcile.test.ts` (imports + `fakeGateway`) with:

```typescript
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { reconcileBalance, THUMBS_UP } from '../src/reconcile';
import type { HistoryGateway, BotGateway, HistoryMessage } from '../src/gateway';
import { currentBucket, previousBucket } from '../src/dates';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', botToken: 'b', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};

interface ReactionCall { messageId: number; emoji: string | null }

function fakeGateways(messages: HistoryMessage[]) {
  const reactions: ReactionCall[] = [];
  const sinceCalls: number[] = [];
  const history: HistoryGateway = {
    async fetchHistory(_chatId, sinceUnix) {
      sinceCalls.push(sinceUnix);
      return messages;
    },
  };
  const bot: BotGateway = {
    async setReaction(_chatId, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage() {},
    async sendPhoto() {},
  };
  return { history, bot, reactions, sinceCalls };
}
```

Then update every test body: replace `const { gateway ... } = fakeGateway(` with `const { history, bot ... } = fakeGateways(`, and replace `reconcileBalance(gateway, config, -100, ...)` with `reconcileBalance(history, bot, config, -100, ...)`. Replace every `hasOurReaction:` in the `HistoryMessage` fixtures with `hasBotReaction:`. The two-gateway destructuring per test:
  - "sums counted current-month messages…": `const { history, bot } = fakeGateways([...])`
  - "adds 👍…": `const { history, bot, reactions } = fakeGateways([...])`
  - "revokes 👍…": `const { history, bot, reactions } = fakeGateways([...])`
  - "does not write…": `const { history, bot, reactions } = fakeGateways([...])`
  - "counts a current-month /to_previous…": `const { history, bot } = fakeGateways([...])`
  - "fetches from the start…": `const { history, bot, sinceCalls } = fakeGateways([])` (both instances)

- [ ] **Step 2: Run the reconcile test to verify it fails**

Run: `npm test -- reconcile`
Expected: FAIL — `HistoryGateway`/`BotGateway` not exported, `reconcileBalance` arity wrong.

- [ ] **Step 3: Rewrite `src/gateway.ts`**

Replace the entire file with:

```typescript
export interface HistoryMessage {
  messageId: number;
  senderId: number;
  text: string;
  dateUnix: number;
  hasBotReaction: boolean;
}

export interface HistoryGateway {
  fetchHistory(chatId: number, sinceUnix: number): Promise<HistoryMessage[]>;
}

export interface BotGateway {
  setReaction(chatId: number, messageId: number, emoji: string | null): Promise<void>;
  sendMessage(chatId: number, text: string): Promise<void>;
  sendPhoto(chatId: number, png: Buffer, filename: string): Promise<void>;
}
```

- [ ] **Step 4: Rewrite `reconcileBalance` in `src/reconcile.ts`**

Change the imports at the top:

```typescript
import type { HistoryGateway, BotGateway } from './gateway';
```

Replace the function signature and body from `export async function reconcileBalance(` through the `fetchHistory` line and the reaction-diff block:

```typescript
export async function reconcileBalance(
  history: HistoryGateway,
  bot: BotGateway,
  config: Config,
  chatId: number,
  which: 'current' | 'previous',
): Promise<string> {
  const target = which === 'current'
    ? currentBucket(config.timezone)
    : previousBucket(config.timezone);
  const sinceUnix = startOfBucketUnix(target, config.timezone);

  const messages = await history.fetchHistory(chatId, sinceUnix);

  const rows: { userId: number; amountCents: number }[] = [];
  for (const m of messages) {
    const c = classify(
      { senderId: m.senderId, text: m.text, dateUnix: m.dateUnix },
      config,
    );
    const desired = c.kind === 'count';
    if (desired && !m.hasBotReaction) {
      await bot.setReaction(chatId, m.messageId, THUMBS_UP);
    } else if (!desired && m.hasBotReaction) {
      await bot.setReaction(chatId, m.messageId, null);
    }
    if (c.kind === 'count' && sameBucket(c.bucket, target)) {
      rows.push({ userId: c.participant.id, amountCents: c.amountCents });
    }
  }

  const balance = computeBalance(config.user1.id, config.user2.id, rows);
  return formatBalance(target, config.user1, config.user2, balance);
}
```

- [ ] **Step 5: Run the reconcile test to verify it passes**

Run: `npm test -- reconcile`
Expected: PASS (all reconcile cases green).

- [ ] **Step 6: Commit**

```bash
git add src/gateway.ts src/reconcile.ts test/reconcile.test.ts
git commit -m "refactor: split gateway into history/bot seams, key reconcile on bot reaction"
```

---

### Task 3: Refactor handlers onto the two gateways

**Files:**
- Modify: `src/handlers.ts`
- Test: `test/handlers.test.ts`

**Interfaces:**
- Consumes: `HistoryGateway`, `BotGateway`, `reconcileBalance(history, bot, …)`.
- Produces:
  - `onNewMessage(history: HistoryGateway, bot: BotGateway, config: Config, chatId: number, ev: IncomingEvent): Promise<void>`
  - `onEditedMessage(bot: BotGateway, config: Config, chatId: number, ev: IncomingEvent): Promise<void>`
  - `IncomingEvent` unchanged: `{ senderId: number; messageId: number; text: string; dateUnix: number }`

- [ ] **Step 1: Rewrite the handlers test for the new signatures**

Replace the top of `test/handlers.test.ts` (imports + `config` + `fake`) with:

```typescript
import { describe, it, expect } from 'vitest';
import { onNewMessage, onEditedMessage } from '../src/handlers';
import { THUMBS_UP } from '../src/reconcile';
import type { HistoryGateway, BotGateway, HistoryMessage } from '../src/gateway';
import { currentBucket } from '../src/dates';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', botToken: 'b', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};
const t = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);

function fake(history: HistoryMessage[] = []) {
  const reactions: { messageId: number; emoji: string | null }[] = [];
  const sent: string[] = [];
  const historyGw: HistoryGateway = {
    async fetchHistory() { return history; },
  };
  const bot: BotGateway = {
    async setReaction(_c, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage(_c, text) { sent.push(text); },
    async sendPhoto() {},
  };
  return { historyGw, bot, reactions, sent };
}
```

Then update each test body:
  - Replace `const { gateway, ... } = fake(...)` with `const { historyGw, bot, ... } = fake(...)`.
  - Replace `onNewMessage(gateway, config, -100, {...})` with `onNewMessage(historyGw, bot, config, -100, {...})`.
  - Replace `onEditedMessage(gateway, config, -100, {...})` with `onEditedMessage(bot, config, -100, {...})`.
  - In the `/balance` test fixture, replace `hasOurReaction: true` with `hasBotReaction: true`.

Concretely, per test the destructuring is:
  - "reacts 👍 to a participant expense": `const { historyGw, bot, reactions } = fake();`
  - "ignores a non-participant": `const { historyGw, bot, reactions, sent } = fake();`
  - "reacts and confirms a valid /to_previous": `const { historyGw, bot, reactions, sent } = fake();`
  - "replies with usage help…": `const { historyGw, bot, reactions, sent } = fake();`
  - "replies to /balance…": `const { historyGw, bot, sent } = fake([ { messageId: 1, senderId: 1, text: '4000', dateUnix: curT, hasBotReaction: true } ]);`
  - "revokes 👍 when an edit removes the number": `const { bot, reactions } = fake();` then `onEditedMessage(bot, config, -100, {...})`
  - "adds 👍 when an edit introduces a number": `const { bot, reactions } = fake();` then `onEditedMessage(bot, config, -100, {...})`

- [ ] **Step 2: Run the handlers test to verify it fails**

Run: `npm test -- handlers`
Expected: FAIL — arity mismatch on `onNewMessage`/`onEditedMessage`.

- [ ] **Step 3: Rewrite `src/handlers.ts`**

Replace the whole file with:

```typescript
import type { HistoryGateway, BotGateway } from './gateway';
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
  history: HistoryGateway,
  bot: BotGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;

  const text = ev.text.trim();
  if (text === '/balance') {
    const report = await reconcileBalance(history, bot, config, chatId, 'current');
    await bot.sendMessage(chatId, report);
    return;
  }
  if (text === '/balance_previous') {
    const report = await reconcileBalance(history, bot, config, chatId, 'previous');
    await bot.sendMessage(chatId, report);
    return;
  }

  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  if (c.kind === 'count') {
    await bot.setReaction(chatId, ev.messageId, THUMBS_UP);
    if (c.source === 'to_previous') {
      await bot.sendMessage(chatId, formatToPreviousConfirmation(c.bucket.month, c.amountCents));
    }
    return;
  }
  // Invalid /to_previous from a participant gets usage help; everything else is silent.
  if (c.kind === 'not_expense' && /^\/to_previous\b/.test(text)) {
    await bot.sendMessage(chatId, TO_PREVIOUS_USAGE);
  }
}

export async function onEditedMessage(
  bot: BotGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;
  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  await bot.setReaction(chatId, ev.messageId, c.kind === 'count' ? THUMBS_UP : null);
}
```

- [ ] **Step 4: Run the handlers test to verify it passes**

Run: `npm test -- handlers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers.ts test/handlers.test.ts
git commit -m "refactor: handlers use history+bot gateways, bot owns writes"
```

---

### Task 4: MTProto history-only gateway + bot-reaction detection

**Files:**
- Modify: `src/telegram-gramjs.ts`
- Test: `test/telegram-gramjs.test.ts` (create)

**Interfaces:**
- Consumes: `Config`, `HistoryGateway`, `HistoryMessage`, `THUMBS_UP`.
- Produces:
  - `botReactedThumbsUp(reactions: Api.MessageReactions | undefined, botUserId: number, emoji: string): boolean`
  - `createHistoryGateway(config: Config, botUserId: number): Promise<{ historyGateway: HistoryGateway; client: TelegramClient }>`
  - No `onUpdate`, no reaction/message/photo writes here anymore.

- [ ] **Step 1: Write the failing detection test**

Create `test/telegram-gramjs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Api } from 'telegram';
import { botReactedThumbsUp } from '../src/telegram-gramjs';

const BOT_ID = 8972200079;

function reactionsWith(peerUserId: number, emoticon: string): Api.MessageReactions {
  return new Api.MessageReactions({
    results: [
      new Api.ReactionCount({ reaction: new Api.ReactionEmoji({ emoticon }), count: 1 }),
    ],
    recentReactions: [
      new Api.MessagePeerReaction({
        peerId: new Api.PeerUser({ userId: BigInt(peerUserId) as unknown as bigInt.BigInteger }),
        date: 0,
        reaction: new Api.ReactionEmoji({ emoticon }),
      }),
    ],
  });
}

describe('botReactedThumbsUp', () => {
  it('is true when the bot peer reacted with 👍', () => {
    expect(botReactedThumbsUp(reactionsWith(BOT_ID, '👍'), BOT_ID, '👍')).toBe(true);
  });

  it('is false when a different peer reacted with 👍', () => {
    expect(botReactedThumbsUp(reactionsWith(999, '👍'), BOT_ID, '👍')).toBe(false);
  });

  it('is false when the bot reacted with a different emoji', () => {
    expect(botReactedThumbsUp(reactionsWith(BOT_ID, '❤'), BOT_ID, '👍')).toBe(false);
  });

  it('is false when there are no reactions', () => {
    expect(botReactedThumbsUp(undefined, BOT_ID, '👍')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the detection test to verify it fails**

Run: `npm test -- telegram-gramjs`
Expected: FAIL — `botReactedThumbsUp` not exported.

- [ ] **Step 3: Rewrite `src/telegram-gramjs.ts`**

Replace the whole file with (history-only; the reaction detector is the extracted, testable core):

```typescript
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { HistoryGateway, HistoryMessage } from './gateway';
import type { Config } from './config';
import { THUMBS_UP } from './reconcile';

function senderIdOf(message: Api.Message): number {
  // Private/group messages: fromId is a PeerUser.
  const from = message.fromId;
  if (from instanceof Api.PeerUser) return Number(from.userId);
  return 0; // anonymous/channel posts are not participants
}

// The bot sets 👍, so MTProto can't use chosenOrder (its own reaction view);
// it must find the bot's peer in the per-peer recentReactions list.
export function botReactedThumbsUp(
  reactions: Api.MessageReactions | undefined,
  botUserId: number,
  emoji: string,
): boolean {
  const recent = reactions?.recentReactions;
  if (!recent) return false;
  return recent.some(
    (r) =>
      r.peerId instanceof Api.PeerUser &&
      Number(r.peerId.userId) === botUserId &&
      r.reaction instanceof Api.ReactionEmoji &&
      r.reaction.emoticon === emoji,
  );
}

export async function createHistoryGateway(
  config: Config,
  botUserId: number,
): Promise<{ historyGateway: HistoryGateway; client: TelegramClient }> {
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.connect();

  const peer = await client.getInputEntity(config.groupChatId);

  const historyGateway: HistoryGateway = {
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
          hasBotReaction: botReactedThumbsUp(m.reactions, botUserId, THUMBS_UP),
        });
      }
      return out;
    },
  };

  return { historyGateway, client };
}
```

- [ ] **Step 4: Run the detection test to verify it passes**

Run: `npm test -- telegram-gramjs`
Expected: PASS. If `BigInt(...) as unknown as bigInt.BigInteger` fails to compile, replace with `returnBigInt(peerUserId)` importing `{ returnBigInt } from 'telegram/Helpers'`; the runtime assertion is what matters.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-gramjs.ts test/telegram-gramjs.test.ts
git commit -m "feat: MTProto history-only gateway with bot-reaction detection"
```

---

### Task 5: grammy bot gateway + group-command normalization

**Files:**
- Create: `src/telegram-bot.ts`
- Test: `test/telegram-bot.test.ts` (create)

**Interfaces:**
- Consumes: `Config`, `BotGateway`, `IncomingEvent`, `THUMBS_UP`.
- Produces:
  - `normalizeCommand(text: string, botUsername: string): string` — strips a leading `/cmd@botusername` down to `/cmd`.
  - `createBotGateway(config: Config): Promise<{ botGateway: BotGateway; bot: Bot; botUserId: number; onUpdate(handler: (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>): void }>`
  - Registers native commands via `setMyCommands`.

- [ ] **Step 1: Write the failing normalization test**

Create `test/telegram-bot.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeCommand } from '../src/telegram-bot';

describe('normalizeCommand', () => {
  it('strips @botusername from a bare command', () => {
    expect(normalizeCommand('/balance@MoneyForKidsBot', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('strips @botusername but keeps arguments', () => {
    expect(normalizeCommand('/to_previous@MoneyForKidsBot 300 x', 'MoneyForKidsBot'))
      .toBe('/to_previous 300 x');
  });

  it('is case-insensitive on the username', () => {
    expect(normalizeCommand('/balance@moneyforkidsbot', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('leaves a plain command untouched', () => {
    expect(normalizeCommand('/balance', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('leaves a non-command expense untouched', () => {
    expect(normalizeCommand('500 грн', 'MoneyForKidsBot')).toBe('500 грн');
  });
});
```

- [ ] **Step 2: Run the normalization test to verify it fails**

Run: `npm test -- telegram-bot`
Expected: FAIL — `src/telegram-bot.ts` does not exist.

- [ ] **Step 3: Create `src/telegram-bot.ts`**

```typescript
import { Bot, InputFile, Context } from 'grammy';
import type { BotGateway } from './gateway';
import type { Config } from './config';
import type { IncomingEvent } from './handlers';

type UpdateHandler = (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>;

const COMMANDS = [
  { command: 'balance', description: 'Баланс за поточний місяць' },
  { command: 'balance_previous', description: 'Баланс за попередній місяць' },
  { command: 'to_previous', description: 'Витрата в попередній місяць: /to_previous <сума> <опис>' },
];

// In groups Telegram appends @botusername to commands; strip it so exact
// command matching and argument parsing in handlers/classify still work.
export function normalizeCommand(text: string, botUsername: string): string {
  return text.replace(
    new RegExp(`^(/[A-Za-z0-9_]+)@${botUsername}\\b`, 'i'),
    '$1',
  );
}

function toEvent(ctx: Context, botUsername: string): IncomingEvent {
  const msg = ctx.msg;
  return {
    senderId: ctx.from?.id ?? 0,
    messageId: msg?.message_id ?? 0,
    text: normalizeCommand(msg?.text ?? '', botUsername),
    dateUnix: msg?.date ?? 0,
  };
}

export async function createBotGateway(config: Config): Promise<{
  botGateway: BotGateway;
  bot: Bot;
  botUserId: number;
  onUpdate(handler: UpdateHandler): void;
}> {
  const bot = new Bot(config.botToken);
  await bot.init();
  const botUserId = bot.botInfo.id;
  const botUsername = bot.botInfo.username;

  await bot.api.setMyCommands(COMMANDS);

  const botGateway: BotGateway = {
    async setReaction(chatId, messageId, emoji) {
      await bot.api.setMessageReaction(
        chatId,
        messageId,
        emoji ? [{ type: 'emoji', emoji }] : [],
      );
    },
    async sendMessage(chatId, text) {
      await bot.api.sendMessage(chatId, text);
    },
    async sendPhoto(chatId, png, filename) {
      await bot.api.sendPhoto(chatId, new InputFile(png, filename));
    },
  };

  function onUpdate(handler: UpdateHandler): void {
    bot.on('message:text', async (ctx) => {
      if (ctx.chat.id !== config.groupChatId) return;
      await handler('new', toEvent(ctx, botUsername));
    });
    bot.on('edited_message:text', async (ctx) => {
      if (ctx.chat.id !== config.groupChatId) return;
      await handler('edit', toEvent(ctx, botUsername));
    });
  }

  return { botGateway, bot, botUserId, onUpdate };
}
```

- [ ] **Step 4: Run the normalization test to verify it passes**

Run: `npm test -- telegram-bot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-bot.ts test/telegram-bot.test.ts
git commit -m "feat: grammy bot gateway with native commands and group-command normalization"
```

---

### Task 6: Wire everything in `index.ts`, banner via bot, full green + manual smoke

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `createBotGateway`, `createHistoryGateway`, `onNewMessage`, `onEditedMessage`, `reconcileBalance`, `scheduleMonthlyBanner`, `renderMonthBanner`, `previousBucket`, `monthNameUpper`.
- Produces: the running process (no exported interface).

- [ ] **Step 1: Rewrite `src/index.ts`**

```typescript
import 'dotenv/config';
import { loadConfig } from './config';
import { createHistoryGateway } from './telegram-gramjs';
import { createBotGateway } from './telegram-bot';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { previousBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const chatId = config.groupChatId;

  const { botGateway, bot, botUserId, onUpdate } = await createBotGateway(config);
  const { historyGateway } = await createHistoryGateway(config, botUserId);

  // Catch up on anything missed while offline (settles previous + current month).
  try {
    await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
  } catch (err) {
    console.warn('Startup reconcile failed; continuing:', err);
  }

  onUpdate(async (kind, ev) => {
    try {
      if (kind === 'new') await onNewMessage(historyGateway, botGateway, config, chatId, ev);
      else await onEditedMessage(botGateway, config, chatId, ev);
    } catch (err) {
      console.error('Update handler failed:', err);
    }
  });

  scheduleMonthlyBanner(config.timezone, async () => {
    try {
      // Settle the just-ended month, then post its banner.
      const bucket = previousBucket(config.timezone);
      await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
      try {
        const png = await renderMonthBanner(bucket.month, bucket.year);
        await botGateway.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
      } catch (err) {
        console.error('Banner render/send failed; sending text fallback:', err);
        try {
          await botGateway.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
        } catch (fallbackErr) {
          console.error('Banner text fallback also failed:', fallbackErr);
        }
      }
    } catch (err) {
      console.error('Monthly banner cron failed:', err);
    }
  });

  await bot.start({ onStart: () => console.log('Ledger bot started.') });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Full type-check**

Run: `npm run typecheck`
Expected: PASS with no errors across `src` and `test`.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — all suites green (config, reconcile, handlers, telegram-gramjs, telegram-bot, balance, classify, dates, parser, format, banner, scheduler, smoke).

- [ ] **Step 4: Manual smoke run**

Prerequisite: bot is a group admin with privacy disabled; `.env` has `BOT_TOKEN` and `GROUP_CHAT_ID=-1004386306971`. Stop any old ledger process first.

Run: `npm start`
Then, in the family group:
  1. Confirm the native command menu (`/balance`, `/balance_previous`, `/to_previous`) autocompletes — the 👍 and replies must come from **@MoneyForKidsBot**, not a personal account.
  2. Send `500 test` from a participant → the **bot** adds 👍. Send `/balance` → bot replies with a reconciled report that includes the 500.
  3. Send `/to_previous 300 x` → bot reacts 👍 and replies with the "Зараховано" confirmation; `/balance_previous` includes the 300.
  4. Edit `500 test` to `lunch` → bot removes its 👍. Edit back to `500` → bot re-adds 👍.
  5. Confirm there are **no double reactions** and the MTProto account posts/reacts nothing.

Expected: all of the above behave as described. If `/balance` errors on a real old message during reconcile, note which message id and stop — that's the `recentReactions`-window edge to discuss, not a silent skip.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire grammy bot + silent MTProto reader, banner via bot"
```

---

## Self-Review

**Spec coverage:**
- grammy bot with native commands → Task 5 (`setMyCommands`) + Task 6 smoke.
- Bot-owned reactions → Tasks 3 (handlers write via `bot`), 5 (`setMessageReaction`).
- Silent MTProto reader → Task 4 (`createHistoryGateway`, no writes/updates).
- `hasOurReaction` → bot-peer detection → Task 4 (`botReactedThumbsUp`, `recentReactions`).
- Gateway split → Task 2.
- `BOT_USER_ID` from `getMe` → Task 5 (`bot.botInfo.id`) threaded into Task 4 via Task 6 wiring.
- Banner via bot → Task 6.
- Group `/cmd@botname` normalization → Task 5 (`normalizeCommand`), an edge the spec implies via "native commands in a group".

**Placeholder scan:** No TBD/TODO; every code step shows full code; the one conditional (BigInt cast fallback in Task 4 Step 4) gives the exact alternative.

**Type consistency:** `hasBotReaction` used consistently across gateway.ts, reconcile.ts, telegram-gramjs.ts, and both test fixtures. `reconcileBalance(history, bot, config, chatId, which)` arity matches in handlers.ts and index.ts. `createHistoryGateway(config, botUserId)` and `createBotGateway(config)` return shapes match their consumers in index.ts. `botReactedThumbsUp` signature identical in impl and test.
