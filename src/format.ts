import type { Participant } from './config';
import type { MonthBucket } from './dates';
import type { BalanceResult } from './balance';

export const MONTHS = [
  'січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень',
];

export function monthNameLower(month: number): string {
  return MONTHS[month - 1];
}

export function monthNameUpper(month: number): string {
  return MONTHS[month - 1].toUpperCase();
}

export function formatHryvnia(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rem = Math.abs(cents % 100);
  return rem === 0 ? `${whole} ₴` : `${whole}.${String(rem).padStart(2, '0')} ₴`;
}

export function formatBalance(
  bucket: MonthBucket,
  user1: Participant,
  user2: Participant,
  balance: BalanceResult,
): string {
  const lines = [
    `Баланс за ${monthNameLower(bucket.month)} ${bucket.year}`,
    '',
    `${user1.nominative}: ${formatHryvnia(balance.user1Cents)}`,
    `${user2.nominative}: ${formatHryvnia(balance.user2Cents)}`,
    `Разом: ${formatHryvnia(balance.totalCents)}`,
    '',
  ];
  if (balance.owedCents === 0 || balance.debtorId === null || balance.creditorId === null) {
    lines.push('Витрати порівну, компенсація не потрібна.');
  } else {
    const debtor = balance.debtorId === user1.id ? user1 : user2;
    const creditor = balance.creditorId === user1.id ? user1 : user2;
    lines.push(`${debtor.nominative} має компенсувати ${creditor.dative}: ${formatHryvnia(balance.owedCents)}`);
  }
  return lines.join('\n');
}

export function formatToPreviousConfirmation(month: number, cents: number): string {
  return `↩️ Зараховано в ${monthNameLower(month)}: ${formatHryvnia(cents)}`;
}
