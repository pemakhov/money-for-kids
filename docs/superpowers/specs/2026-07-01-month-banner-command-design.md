# `/month` command — post the current-month banner on demand

## Goal

Add a Telegram slash command `/month` that posts the big month-name banner
(the same PNG rendered by `renderMonthBanner`) for the **current** month, on
demand. This is the manual counterpart to the automatic 1st-of-month cron
banner.

## Behavior

- A participant sends `/month`.
- The bot renders the current month's banner (big month name + year) and posts
  it as a photo to the group.
- Purely cosmetic: **no balance reconcile** (unlike the cron, which settles the
  previous month before posting).
- Month is always the current month (via `currentBucket(config.timezone)`); no
  arguments.
- Non-participants are ignored, consistent with every other command in
  `onNewMessage`.
- On render/send failure, fall back to a text message
  (`📅 <MONTH> <year> 📅`), mirroring the cron's existing fallback.

## Changes

### 1. Shared helper — `src/banner.ts`

Extract the render-and-post-with-text-fallback logic (currently inline in
`index.ts`'s cron) into a reusable function so the cron and the command don't
duplicate it:

```ts
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

Imports `BotGateway` from `./gateway`, `MonthBucket` from `./dates`,
`monthNameUpper` from `./format`.

### 2. `src/index.ts` (cron)

Replace the inline render/send/fallback block in the cron callback with a call
to `postMonthBanner(botGateway, chatId, bucket)`. The cron keeps its
`reconcileBalance(..., 'previous')` call before posting. Drop now-unused
imports (`renderMonthBanner`, `monthNameUpper`) if the helper covers them.

### 3. `src/handlers.ts`

- Add a `text === '/month'` branch in `onNewMessage`, after the existing
  command branches and before `classify`. It is already inside the
  `isParticipant` guard.

  ```ts
  if (text === '/month') {
    await postMonthBanner(bot, chatId, currentBucket(config.timezone));
    return;
  }
  ```

- Add imports: `postMonthBanner` from `./banner`, `currentBucket` from
  `./dates`.
- Add `/month` to the `HELP` text (a line under Команди).

### 4. `src/telegram-bot.ts`

Add to `COMMANDS` so it appears in Telegram's command menu:

```ts
{ command: 'month', description: 'Банер із назвою поточного місяця' },
```

## Testing

`test/handlers.test.ts`:

- Extend the `fake()` bot so `sendPhoto` records calls (e.g. push
  `{ filename }` or a `photos` array), instead of the current no-op.
- Test: a participant sends `/month` → `sendPhoto` is called once with the
  current month's filename (`${cur.year}-${cur.month}.png`), no reaction, no
  reconcile needed.
- Test: a non-participant sends `/month` → no `sendPhoto`, no `sendMessage`.

Existing tests for `renderMonthBanner` (`test/banner.test.ts`) already cover the
rendering itself; `postMonthBanner`'s fallback path is simple enough to leave to
the cron/handler tests, but an optional unit test can force `renderMonthBanner`
to throw and assert the text fallback.

## Out of scope

- Month arguments / overriding the month.
- Any balance/reconcile behavior on `/month`.
