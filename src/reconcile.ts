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
