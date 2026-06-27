import { describe, it, expect } from 'vitest';
import { formatHryvnia, formatBalance, formatToPreviousConfirmation, monthNameUpper } from '../src/format';

const u1 = { id: 1, nominative: 'Сергій', dative: 'Сергію' };
const u2 = { id: 2, nominative: 'Марина', dative: 'Марині' };

describe('formatHryvnia', () => {
  it('whole hryvnia without decimals', () => expect(formatHryvnia(400000)).toBe('4000 ₴'));
  it('keeps two decimals when present', () => expect(formatHryvnia(30025)).toBe('300.25 ₴'));
});

describe('monthNameUpper', () => {
  it('uppercases the Ukrainian month', () => expect(monthNameUpper(6)).toBe('ЧЕРВЕНЬ'));
});

describe('formatBalance', () => {
  it('Марина owes Сергій (dative)', () => {
    const text = formatBalance(
      { year: 2026, month: 6 }, u1, u2,
      { user1Cents: 400000, user2Cents: 100000, totalCents: 500000, debtorId: 2, creditorId: 1, owedCents: 150000 },
    );
    expect(text).toContain('Баланс за червень 2026');
    expect(text).toContain('Сергій: 4000 ₴');
    expect(text).toContain('Марина: 1000 ₴');
    expect(text).toContain('Разом: 5000 ₴');
    expect(text).toContain('Марина має компенсувати Сергію: 1500 ₴');
  });

  it('Сергій owes Марина (dative) in the other direction', () => {
    const text = formatBalance(
      { year: 2026, month: 6 }, u1, u2,
      { user1Cents: 0, user2Cents: 200000, totalCents: 200000, debtorId: 1, creditorId: 2, owedCents: 100000 },
    );
    expect(text).toContain('Сергій має компенсувати Марині: 1000 ₴');
  });

  it('equal totals -> no compensation line', () => {
    const text = formatBalance(
      { year: 2026, month: 6 }, u1, u2,
      { user1Cents: 5000, user2Cents: 5000, totalCents: 10000, debtorId: null, creditorId: null, owedCents: 0 },
    );
    expect(text).toContain('компенсація не потрібна');
  });
});

describe('formatToPreviousConfirmation', () => {
  it('names the month and amount', () => {
    expect(formatToPreviousConfirmation(5, 30000)).toContain('травень');
    expect(formatToPreviousConfirmation(5, 30000)).toContain('300 ₴');
  });
});
