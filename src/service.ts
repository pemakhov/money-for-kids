import { DateTime } from 'luxon';
import type { Config, Participant } from './config';
import type { Db } from './db';
import { insertExpense, getExpensesForBucket } from './db';
import { parseAmountCents } from './parser';
import { bucketFromUtc, previousBucket, currentBucket, nowUtcISO } from './dates';
import { computeBalance } from './balance';
import { formatBalance, formatToPreviousConfirmation } from './format';

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  userId: number;
  text: string;
  dateUnix: number;
}

export type ExpenseOutcome = 'ignored' | 'accounted' | 'duplicate';

function participantFor(config: Config, userId: number): Participant | null {
  if (userId === config.user1.id) return config.user1;
  if (userId === config.user2.id) return config.user2;
  return null;
}

export function handleExpenseMessage(db: Db, config: Config, msg: IncomingMessage): ExpenseOutcome {
  const participant = participantFor(config, msg.userId);
  if (!participant) return 'ignored';
  const amountCents = parseAmountCents(msg.text);
  if (amountCents === null) return 'ignored';
  const createdAtUtc = DateTime.fromSeconds(msg.dateUnix, { zone: 'utc' }).toISO()!;
  const bucket = bucketFromUtc(createdAtUtc, config.timezone);
  const inserted = insertExpense(db, {
    chatId: msg.chatId, messageId: msg.messageId, userId: msg.userId,
    userName: participant.nominative, amountCents, description: msg.text,
    year: bucket.year, month: bucket.month, createdAtUtc, source: 'message',
  });
  return inserted ? 'accounted' : 'duplicate';
}

export interface ToPreviousResult {
  reply: string;
  stored: boolean;
}

export function handleToPrevious(db: Db, config: Config, msg: IncomingMessage, argsText: string): ToPreviousResult {
  const participant = participantFor(config, msg.userId);
  if (!participant) {
    return { reply: 'Лише Сергій або Марина можуть додавати витрати.', stored: false };
  }
  const amountCents = parseAmountCents(argsText);
  if (amountCents === null) {
    return {
      reply: 'Використання: /to_previous <сума> <опис>\nНаприклад: /to_previous 300 Максу на бутерброд',
      stored: false,
    };
  }
  const createdAtUtc = nowUtcISO();
  const bucket = previousBucket(config.timezone);
  const inserted = insertExpense(db, {
    chatId: msg.chatId, messageId: msg.messageId, userId: msg.userId,
    userName: participant.nominative, amountCents, description: argsText.trim(),
    year: bucket.year, month: bucket.month, createdAtUtc, source: 'to_previous',
  });
  if (!inserted) {
    return { reply: 'Цю команду вже зараховано.', stored: false };
  }
  return { reply: formatToPreviousConfirmation(bucket.month, amountCents), stored: true };
}

export function buildBalanceReport(db: Db, config: Config, chatId: number, which: 'current' | 'previous'): string {
  const bucket = which === 'current' ? currentBucket(config.timezone) : previousBucket(config.timezone);
  const rows = getExpensesForBucket(db, chatId, bucket.year, bucket.month);
  const balance = computeBalance(config.user1.id, config.user2.id, rows);
  return formatBalance(bucket, config.user1, config.user2, balance);
}
