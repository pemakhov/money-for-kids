import { describe, it, expect } from 'vitest';
import { computeBalance } from '../src/balance';

describe('computeBalance', () => {
  it('user1 paid more -> user2 is debtor, owes half the difference', () => {
    const r = computeBalance(1, 2, [
      { userId: 1, amountCents: 400000 },
      { userId: 2, amountCents: 100000 },
    ]);
    expect(r.user1Cents).toBe(400000);
    expect(r.user2Cents).toBe(100000);
    expect(r.totalCents).toBe(500000);
    expect(r.debtorId).toBe(2);
    expect(r.creditorId).toBe(1);
    expect(r.owedCents).toBe(150000);
  });

  it('user2 paid more -> user1 is debtor', () => {
    const r = computeBalance(1, 2, [{ userId: 2, amountCents: 200000 }]);
    expect(r.debtorId).toBe(1);
    expect(r.creditorId).toBe(2);
    expect(r.owedCents).toBe(100000);
  });

  it('equal totals -> nobody owes', () => {
    const r = computeBalance(1, 2, [
      { userId: 1, amountCents: 5000 },
      { userId: 2, amountCents: 5000 },
    ]);
    expect(r.debtorId).toBeNull();
    expect(r.creditorId).toBeNull();
    expect(r.owedCents).toBe(0);
  });

  it('ignores rows from unknown users and rounds odd cents', () => {
    const r = computeBalance(1, 2, [
      { userId: 1, amountCents: 101 },
      { userId: 2, amountCents: 0 },
      { userId: 99, amountCents: 999999 },
    ]);
    expect(r.totalCents).toBe(101);
    expect(r.owedCents).toBe(51); // round(101/2)
  });
});
