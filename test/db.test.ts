import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, insertExpense, getExpensesForBucket, setMeta, getMeta, type InsertExpenseInput } from '../src/db';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

const baseRow: InsertExpenseInput = {
  chatId: -100, messageId: 1, userId: 1, userName: 'Сергій',
  amountCents: 400000, description: '4000 грн', year: 2026, month: 6,
  createdAtUtc: '2026-06-10T08:00:00.000Z', source: 'message',
};

describe('db', () => {
  it('inserts an expense and reads it back for the bucket', () => {
    const db = freshDb();
    expect(insertExpense(db, baseRow)).toBe(true);
    const rows = getExpensesForBucket(db, -100, 2026, 6);
    expect(rows).toEqual([{ userId: 1, amountCents: 400000 }]);
  });

  it('ignores duplicate (chatId, messageId) and returns false', () => {
    const db = freshDb();
    expect(insertExpense(db, baseRow)).toBe(true);
    expect(insertExpense(db, { ...baseRow, amountCents: 999 })).toBe(false);
    expect(getExpensesForBucket(db, -100, 2026, 6)).toHaveLength(1);
  });

  it('separates buckets and chats', () => {
    const db = freshDb();
    insertExpense(db, baseRow);
    insertExpense(db, { ...baseRow, messageId: 2, month: 7 });
    expect(getExpensesForBucket(db, -100, 2026, 6)).toHaveLength(1);
    expect(getExpensesForBucket(db, -100, 2026, 7)).toHaveLength(1);
    expect(getExpensesForBucket(db, -999, 2026, 6)).toHaveLength(0);
  });

  it('stores and updates meta', () => {
    const db = freshDb();
    expect(getMeta(db, 'group_chat_id')).toBeNull();
    setMeta(db, 'group_chat_id', '-100');
    expect(getMeta(db, 'group_chat_id')).toBe('-100');
    setMeta(db, 'group_chat_id', '-200');
    expect(getMeta(db, 'group_chat_id')).toBe('-200');
  });
});
