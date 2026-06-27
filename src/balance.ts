export interface ExpenseRow {
  userId: number;
  amountCents: number;
}

export interface BalanceResult {
  user1Cents: number;
  user2Cents: number;
  totalCents: number;
  debtorId: number | null;
  creditorId: number | null;
  owedCents: number;
}

export function computeBalance(user1Id: number, user2Id: number, rows: ExpenseRow[]): BalanceResult {
  let user1Cents = 0;
  let user2Cents = 0;
  for (const r of rows) {
    if (r.userId === user1Id) user1Cents += r.amountCents;
    else if (r.userId === user2Id) user2Cents += r.amountCents;
  }
  const totalCents = user1Cents + user2Cents;
  const diff = user1Cents - user2Cents;
  if (diff === 0) {
    return { user1Cents, user2Cents, totalCents, debtorId: null, creditorId: null, owedCents: 0 };
  }
  const owedCents = Math.round(Math.abs(diff) / 2);
  if (diff > 0) {
    return { user1Cents, user2Cents, totalCents, debtorId: user2Id, creditorId: user1Id, owedCents };
  }
  return { user1Cents, user2Cents, totalCents, debtorId: user1Id, creditorId: user2Id, owedCents };
}
