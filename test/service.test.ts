import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db';
import { currentBucket, previousBucket } from '../src/dates';
import { handleExpenseMessage, handleToPrevious, buildBalanceReport, type IncomingMessage } from '../src/service';
import type { Config } from '../src/config';

const config: Config = {
  botToken: 't',
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
  dbPath: ':memory:',
};

function freshDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

// 10 June 2026 12:00 UTC
const JUNE_UNIX = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);
function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return { chatId: -100, messageId: 1, userId: 1, text: '4000 грн', dateUnix: JUNE_UNIX, ...over };
}

describe('handleExpenseMessage', () => {
  it('accounts a participant expense, dedupes the second time', () => {
    const db = freshDb();
    expect(handleExpenseMessage(db, config, msg())).toBe('accounted');
    expect(handleExpenseMessage(db, config, msg())).toBe('duplicate');
  });
  it('ignores non-participants', () => {
    const db = freshDb();
    expect(handleExpenseMessage(db, config, msg({ userId: 999 }))).toBe('ignored');
  });
  it('ignores messages not starting with a number', () => {
    const db = freshDb();
    expect(handleExpenseMessage(db, config, msg({ text: 'купив зошити' }))).toBe('ignored');
  });
});

describe('handleToPrevious', () => {
  it('stores into the previous month and confirms', () => {
    const db = freshDb();
    const res = handleToPrevious(db, config, msg({ messageId: 5 }), '300 Максу на бутерброд');
    expect(res.stored).toBe(true);
    const prev = previousBucket(config.timezone);
    expect(buildBalanceReport(db, config, -100, 'previous')).toContain('Сергій: 300 ₴');
    expect(res.reply).toContain('Зараховано');
    void prev;
  });
  it('rejects missing amount with usage help', () => {
    const db = freshDb();
    const res = handleToPrevious(db, config, msg({ messageId: 6 }), 'просто текст');
    expect(res.stored).toBe(false);
    expect(res.reply).toContain('/to_previous');
  });
  it('rejects non-participants', () => {
    const db = freshDb();
    const res = handleToPrevious(db, config, msg({ messageId: 7, userId: 999 }), '300 x');
    expect(res.stored).toBe(false);
  });
});

describe('buildBalanceReport', () => {
  it('sums the current month and shows the table', () => {
    const db = freshDb();
    const cur = currentBucket(config.timezone);
    // craft a message timestamped in the current month so it lands in the current bucket
    const curUnix = Math.floor(Date.UTC(cur.year, cur.month - 1, 15, 12, 0, 0) / 1000);
    handleExpenseMessage(db, config, msg({ messageId: 10, userId: 1, text: '4000 грн', dateUnix: curUnix }));
    handleExpenseMessage(db, config, msg({ messageId: 11, userId: 2, text: '1000 грн', dateUnix: curUnix }));
    const report = buildBalanceReport(db, config, -100, 'current');
    expect(report).toContain('Сергій: 4000 ₴');
    expect(report).toContain('Марина: 1000 ₴');
    expect(report).toContain('Марина має компенсувати Сергію: 1500 ₴');
  });
});
