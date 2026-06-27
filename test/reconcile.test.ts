import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
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
  const sinceCalls: number[] = [];
  const gateway: TelegramGateway = {
    async fetchHistory(_chatId, sinceUnix) {
      sinceCalls.push(sinceUnix);
      return messages;
    },
    async setReaction(_chatId, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage() {},
    async sendPhoto() {},
  };
  return { gateway, reactions, sinceCalls };
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

  it('fetches from the start of the target month in the config timezone', async () => {
    const cur = currentBucket(config.timezone);
    const { gateway, sinceCalls } = fakeGateway([]);
    await reconcileBalance(gateway, config, -100, 'current');
    const expectedCurSinceUnix = Math.floor(
      DateTime.fromObject(
        { year: cur.year, month: cur.month, day: 1 },
        { zone: config.timezone },
      ).toSeconds(),
    );
    expect(sinceCalls[0]).toBe(expectedCurSinceUnix);

    const prev = previousBucket(config.timezone);
    const { gateway: gatewayPrev, sinceCalls: sinceCallsPrev } = fakeGateway([]);
    await reconcileBalance(gatewayPrev, config, -100, 'previous');
    const expectedPrevSinceUnix = Math.floor(
      DateTime.fromObject(
        { year: prev.year, month: prev.month, day: 1 },
        { zone: config.timezone },
      ).toSeconds(),
    );
    expect(sinceCallsPrev[0]).toBe(expectedPrevSinceUnix);
  });
});
