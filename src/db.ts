import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExpenseRow } from './balance';

export type Db = Database.Database;

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      description TEXT,
      accounting_year INTEGER NOT NULL,
      accounting_month INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(chat_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export interface InsertExpenseInput {
  chatId: number;
  messageId: number;
  userId: number;
  userName: string;
  amountCents: number;
  description: string;
  year: number;
  month: number;
  createdAtUtc: string;
  source: 'message' | 'to_previous';
}

export function insertExpense(db: Db, input: InsertExpenseInput): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO expenses
      (chat_id, message_id, user_id, user_name, amount_cents, description,
       accounting_year, accounting_month, created_at_utc, source)
    VALUES
      (@chatId, @messageId, @userId, @userName, @amountCents, @description,
       @year, @month, @createdAtUtc, @source)
  `);
  return stmt.run(input).changes > 0;
}

export function getExpensesForBucket(db: Db, chatId: number, year: number, month: number): ExpenseRow[] {
  return db.prepare(`
    SELECT user_id AS userId, amount_cents AS amountCents
    FROM expenses
    WHERE chat_id = ? AND accounting_year = ? AND accounting_month = ?
  `).all(chatId, year, month) as ExpenseRow[];
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : null;
}
