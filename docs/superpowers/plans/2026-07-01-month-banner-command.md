# `/month` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/month` Telegram command that posts the current month's big-name banner on demand.

**Architecture:** Extract the cron's inline "render banner, post photo, fall back to text" logic into a shared `postMonthBanner(bot, chatId, bucket)` helper in `src/banner.ts`. The 1st-of-month cron and the new `/month` handler branch both call it — the cron with the previous bucket, the command with the current bucket. `/month` is participant-gated and does no balance reconcile.

**Tech Stack:** TypeScript, grammy (bot), sharp (banner render), luxon (dates), vitest (tests).

## Global Constraints

- No new dependencies.
- Bot-facing copy is Ukrainian, matching existing `COMMANDS` / `HELP` strings.
- Follow existing patterns: command branches live in `onNewMessage` under the `isParticipant` guard; `BotGateway` is the transport interface.
- Banner filename format is `${bucket.year}-${bucket.month}.png` (verbatim from existing cron).

---

### Task 1: Extract `postMonthBanner` shared helper and use it in the cron

**Files:**
- Modify: `src/banner.ts` (add `postMonthBanner`)
- Modify: `src/index.ts:35-54` (cron uses the helper)
- Test: `test/banner.test.ts`

**Interfaces:**
- Consumes: `renderMonthBanner(month: number, year: number): Promise<Buffer>` (existing), `BotGateway` from `./gateway`, `MonthBucket` from `./dates`, `monthNameUpper(month: number): string` from `./format`.
- Produces: `postMonthBanner(bot: BotGateway, chatId: number, bucket: MonthBucket): Promise<void>` — renders `bucket`'s banner and sends it as a photo; on any render/send error logs and sends the text fallback `📅 <MONTH> <year> 📅`; never throws.

- [ ] **Step 1: Write the failing test**

Add to `test/banner.test.ts`:

```ts
import { renderMonthBanner, postMonthBanner } from '../src/banner';
import type { BotGateway } from '../src/gateway';

function fakeBot() {
  const photos: { filename: string }[] = [];
  const messages: string[] = [];
  const bot: BotGateway = {
    async setReaction() {},
    async sendMessage(_c, text) { messages.push(text); },
    async sendPhoto(_c, _png, filename) { photos.push({ filename }); },
  };
  return { bot, photos, messages };
}

describe('postMonthBanner', () => {
  it('sends a photo with the bucket filename', async () => {
    const { bot, photos, messages } = fakeBot();
    await postMonthBanner(bot, -100, { year: 2026, month: 7 });
    expect(photos).toEqual([{ filename: '2026-7.png' }]);
    expect(messages).toEqual([]);
  });

  it('falls back to a text message when sending the photo fails', async () => {
    const messages: string[] = [];
    const bot: BotGateway = {
      async setReaction() {},
      async sendMessage(_c, text) { messages.push(text); },
      async sendPhoto() { throw new Error('boom'); },
    };
    await postMonthBanner(bot, -100, { year: 2026, month: 7 });
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('2026');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/banner.test.ts`
Expected: FAIL — `postMonthBanner` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/banner.ts`, add imports and the helper (keep existing `renderMonthBanner`):

```ts
import type { BotGateway } from './gateway';
import type { MonthBucket } from './dates';
import { monthNameUpper } from './format';

export async function postMonthBanner(
  bot: BotGateway,
  chatId: number,
  bucket: MonthBucket,
): Promise<void> {
  try {
    const png = await renderMonthBanner(bucket.month, bucket.year);
    await bot.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
  } catch (err) {
    console.error('Banner render/send failed; sending text fallback:', err);
    try {
      await bot.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
    } catch (fallbackErr) {
      console.error('Banner text fallback also failed:', fallbackErr);
    }
  }
}
```

Note: `src/banner.ts` already imports `monthNameUpper` from `./format` at the top — reuse that import rather than adding a duplicate.

- [ ] **Step 4: Update the cron to use the helper**

In `src/index.ts`, replace the inner render/send/fallback block (lines ~40-50) so the cron callback body becomes:

```ts
scheduleMonthlyBanner(config.timezone, async () => {
  try {
    // Settle the just-ended month, then post its banner.
    const bucket = previousBucket(config.timezone);
    await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
    await postMonthBanner(botGateway, chatId, bucket);
  } catch (err) {
    console.error('Monthly banner cron failed:', err);
  }
});
```

Update imports in `src/index.ts`: replace `import { renderMonthBanner } from './banner';` with `import { postMonthBanner } from './banner';`, and remove the now-unused `import { monthNameUpper } from './format';` (verify it is not used elsewhere in the file first).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/banner.test.ts && npm run typecheck`
Expected: PASS; no type errors (confirms no unused imports remain in `index.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/banner.ts src/index.ts test/banner.test.ts
git commit -m "refactor: extract postMonthBanner helper, use it in cron"
```

---

### Task 2: Add the `/month` command

**Files:**
- Modify: `src/handlers.ts` (add `/month` branch + HELP line + imports)
- Modify: `src/telegram-bot.ts:9-14` (register command)
- Test: `test/handlers.test.ts`

**Interfaces:**
- Consumes: `postMonthBanner(bot, chatId, bucket)` from Task 1; `currentBucket(timezone: string): MonthBucket` from `./dates` (existing).
- Produces: none downstream.

- [ ] **Step 1: Update the handlers test's fake bot to record photos**

In `test/handlers.test.ts`, change the `fake()` helper's bot so `sendPhoto` records calls:

```ts
const photos: { filename: string }[] = [];
const bot: BotGateway = {
  async setReaction(_c, messageId, emoji) { reactions.push({ messageId, emoji }); },
  async sendMessage(_c, text) { sent.push(text); },
  async sendPhoto(_c, _png, filename) { photos.push({ filename }); },
};
return { historyGw, bot, reactions, sent, photos };
```

- [ ] **Step 2: Write the failing tests**

Add inside `describe('onNewMessage', ...)` in `test/handlers.test.ts`:

```ts
it('posts the current month banner for a participant /month', async () => {
  const cur = currentBucket(config.timezone);
  const { historyGw, bot, photos, reactions } = fake();
  await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 20, text: '/month', dateUnix: t });
  expect(photos).toEqual([{ filename: `${cur.year}-${cur.month}.png` }]);
  expect(reactions).toEqual([]);
});

it('ignores /month from a non-participant', async () => {
  const { historyGw, bot, photos, sent } = fake();
  await onNewMessage(historyGw, bot, config, -100, { senderId: 999, messageId: 21, text: '/month', dateUnix: t });
  expect(photos).toEqual([]);
  expect(sent).toEqual([]);
});
```

(`currentBucket` is already imported in this test file.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/handlers.test.ts`
Expected: FAIL — first new test finds `photos` empty (no `/month` branch yet).

- [ ] **Step 4: Implement the `/month` branch**

In `src/handlers.ts`, add imports at the top:

```ts
import { postMonthBanner } from './banner';
import { currentBucket } from './dates';
```

Add the branch in `onNewMessage`, after the `/balance_previous` branch and before the `classify` call:

```ts
if (text === '/month') {
  await postMonthBanner(bot, chatId, currentBucket(config.timezone));
  return;
}
```

Add a `/month` line to the `HELP` string, under the Команди block:

```ts
'/to_previous <сума> <опис> — витрата в попередній місяць\n' +
'/month — банер із назвою поточного місяця\n' +
'/help — ця довідка';
```

- [ ] **Step 5: Register the command in the menu**

In `src/telegram-bot.ts`, add to the `COMMANDS` array (after `to_previous`):

```ts
{ command: 'month', description: 'Банер із назвою поточного місяця' },
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — all tests green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/handlers.ts src/telegram-bot.ts test/handlers.test.ts
git commit -m "feat: add /month command to post current-month banner"
```

---

### Task 3: Document the command in the README

**Files:**
- Modify: `README.md` (Usage section)

- [ ] **Step 1: Add a `/month` bullet to the Usage list**

In `README.md`, under the Usage section's command bullets (near `/to_previous`), add:

```markdown
- `/month` — post a banner image with the current month's name.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document /month command in README"
```

---

## Notes for the implementer

- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`.
- `npm run typecheck` is the fastest way to catch an unused/leftover import after the `index.ts` refactor.
- Keep the banner filename exactly `${bucket.year}-${bucket.month}.png` (no zero-padding) — the tests assert this literally and it matches the existing cron.
