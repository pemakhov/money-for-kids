# Money for Kids Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript Telegram bot for two co-parents to log kids' expenses in a group chat, mark each accounted message with ✅, report 50/50 monthly balances, allow back-dating to the previous month, and post a monthly image banner.

**Architecture:** Long-polling grammY bot. All business logic lives in small pure modules (`parser`, `dates`, `balance`, `format`) plus a `service` layer that talks to SQLite via `db`. Telegram glue (`bot.ts`, `index.ts`) is thin and delegates to the service. Pure modules and the service are unit-tested with vitest; the in-memory SQLite database makes service tests deterministic.

**Tech Stack:** Node.js 24 (ESM), TypeScript 6, grammY 1.44, better-sqlite3 12, luxon 3, node-cron 4, sharp 0.35, vitest 4, tsx (run/dev), dotenv.

## Global Constraints

- **Language:** TypeScript, ESM only (`"type": "module"`). Run via `tsx`; typecheck via `tsc --noEmit` (never emit JS).
- **Participants:** exactly two, identified by Telegram numeric user ID from `.env` (`USER1_ID`, `USER2_ID`). Names are **constants**: `USER1 = { nominative: 'Сергій', dative: 'Сергію' }`, `USER2 = { nominative: 'Марина', dative: 'Марині' }`.
- **Output language:** Ukrainian.
- **Money:** stored and computed in integer **cents**; never use floats for stored amounts. Currency symbol `₴`.
- **Split:** 50/50. Compensation = `round(|paid1 − paid2| / 2)`; the one who paid less compensates the one who paid more. Compensation sentence: `«{payer.nominative} має компенсувати {recipient.dative}: {amount} ₴»`.
- **Timezone:** `Europe/Kyiv` default, from `TIMEZONE` env. All month bucketing is timezone-aware.
- **Marking:** valid expense message → react `✅` (fallback to a text reply if reaction not permitted).
- **Commands:** `/balance`, `/balance_previous`, `/to_previous`.
- **Accounting month model:** every expense row carries an explicit `(accounting_year, accounting_month)`. Normal messages → the month of the message timestamp (in TZ). `/to_previous` → the previous month. `/balance` sums the current month; `/balance_previous` sums the previous month — this is what makes back-dated entries appear in the previous-month report.

---

## File Structure

```
src/
  config.ts     loadConfig(): Config; name constants; env validation
  parser.ts     parseAmountCents(text): number | null            [pure]
  dates.ts      MonthBucket + current/previous/fromUtc helpers    [pure, luxon]
  balance.ts    computeBalance(...): BalanceResult                [pure]
  format.ts     month names, formatHryvnia, formatBalance, ...    [pure]
  db.ts         openDb/migrate/insertExpense/getExpensesForBucket/meta
  service.ts    handleExpenseMessage/handleToPrevious/buildBalanceReport
  banner.ts     renderMonthBanner(month, year): Promise<Buffer>   [sharp]
  scheduler.ts  scheduleMonthlyBanner(tz, onFire)                 [node-cron]
  bot.ts        createBot(config, db): Bot — all Telegram handlers
  index.ts      entrypoint: config → db → bot → commands → cron → start
test/
  parser.test.ts dates.test.ts balance.test.ts format.test.ts
  config.test.ts db.test.ts service.test.ts banner.test.ts scheduler.test.ts
.env.example  package.json  tsconfig.json  README.md
data/          sqlite db file (gitignored)
```

**Note:** the design spec listed a `handlers/` directory with three files; because the handlers are trivial glue, this plan consolidates them into a single `bot.ts`. All behavior is identical.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `test/smoke.test.ts`
- Modify: `.gitignore` (already present — verify it ignores `node_modules/`, `data/`, `.env`, `dist/`)

**Interfaces:**
- Produces: npm scripts `test`, `typecheck`, `dev`, `start`; ESM project that vitest and tsx can run.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "money-for-kids",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^12.11.1",
    "dotenv": "^17.4.2",
    "grammy": "^1.44.0",
    "luxon": "^3.7.2",
    "node-cron": "^4.5.0",
    "sharp": "^0.35.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/luxon": "^3.7.2",
    "@types/node": "^26.0.1",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `.env.example`**

```
BOT_TOKEN=put-your-bot-token-here
USER1_ID=111111111
USER2_ID=222222222
TIMEZONE=Europe/Kyiv
DB_PATH=./data/expenses.db
```

- [ ] **Step 4: Create `test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes; `better-sqlite3` and `sharp` build/download prebuilt binaries without error.

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 7: Verify `.gitignore`**

Confirm `.gitignore` contains `node_modules/`, `data/`, `.env`, `dist/`. (It was created earlier; add any missing lines.)

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .env.example test/smoke.test.ts .gitignore package-lock.json
git commit -m "chore: scaffold TypeScript ESM project with vitest"
```

---

## Task 2: Config module

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Participant { id: number; nominative: string; dative: string }`
  - `interface Config { botToken: string; user1: Participant; user2: Participant; timezone: string; dbPath: string }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): Config`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  BOT_TOKEN: 'token', USER1_ID: '111', USER2_ID: '222',
  TIMEZONE: 'Europe/Kyiv', DB_PATH: './data/x.db',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('loads ids from env and fixed Ukrainian names', () => {
    const c = loadConfig(base);
    expect(c.botToken).toBe('token');
    expect(c.user1).toEqual({ id: 111, nominative: 'Сергій', dative: 'Сергію' });
    expect(c.user2).toEqual({ id: 222, nominative: 'Марина', dative: 'Марині' });
    expect(c.timezone).toBe('Europe/Kyiv');
    expect(c.dbPath).toBe('./data/x.db');
  });

  it('defaults timezone and dbPath when absent', () => {
    const c = loadConfig({ BOT_TOKEN: 't', USER1_ID: '1', USER2_ID: '2' } as NodeJS.ProcessEnv);
    expect(c.timezone).toBe('Europe/Kyiv');
    expect(c.dbPath).toBe('./data/expenses.db');
  });

  it('throws when BOT_TOKEN is missing', () => {
    expect(() => loadConfig({ USER1_ID: '1', USER2_ID: '2' } as NodeJS.ProcessEnv)).toThrow(/BOT_TOKEN/);
  });

  it('throws when a user id is not an integer', () => {
    expect(() => loadConfig({ ...base, USER1_ID: 'abc' })).toThrow(/USER1_ID/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config`.

- [ ] **Step 3: Write the implementation**

```ts
export interface Participant {
  id: number;
  nominative: string;
  dative: string;
}

export interface Config {
  botToken: string;
  user1: Participant;
  user2: Participant;
  timezone: string;
  dbPath: string;
}

const USER1_NAME = { nominative: 'Сергій', dative: 'Сергію' } as const;
const USER2_NAME = { nominative: 'Марина', dative: 'Марині' } as const;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

function requireIntEnv(env: NodeJS.ProcessEnv, key: string): number {
  const raw = requireEnv(env, key);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || String(n) !== raw) {
    throw new Error(`Env var ${key} must be an integer, got: ${raw}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    botToken: requireEnv(env, 'BOT_TOKEN'),
    user1: { id: requireIntEnv(env, 'USER1_ID'), ...USER1_NAME },
    user2: { id: requireIntEnv(env, 'USER2_ID'), ...USER2_NAME },
    timezone: env.TIMEZONE?.trim() || 'Europe/Kyiv',
    dbPath: env.DB_PATH?.trim() || './data/expenses.db',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: config module with env validation and name constants"
```

---

## Task 3: Amount parser

**Files:**
- Create: `src/parser.ts`, `test/parser.test.ts`

**Interfaces:**
- Produces: `function parseAmountCents(text: string): number | null` — reads the leading number of a message and returns it in integer cents, or `null` if the message does not start with a positive number.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseAmountCents } from '../src/parser';

describe('parseAmountCents', () => {
  it('parses a plain integer at the start', () => {
    expect(parseAmountCents('4000 гривень Ігорю на місяць')).toBe(400000);
  });
  it('parses a space-separated thousands amount', () => {
    expect(parseAmountCents('4 000 грн Максу')).toBe(400000);
  });
  it('parses a dot decimal', () => {
    expect(parseAmountCents('4000.50 на книжки')).toBe(400050);
  });
  it('parses a comma decimal', () => {
    expect(parseAmountCents('300,25 цукерки')).toBe(30025);
  });
  it('returns null when not starting with a number', () => {
    expect(parseAmountCents('купив зошити 50')).toBeNull();
  });
  it('returns null for empty / whitespace', () => {
    expect(parseAmountCents('   ')).toBeNull();
  });
  it('returns null for zero and negatives', () => {
    expect(parseAmountCents('0 нічого')).toBeNull();
    expect(parseAmountCents('-5 borrow')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parser.test.ts`
Expected: FAIL — cannot find module `../src/parser`.

- [ ] **Step 3: Write the implementation**

```ts
const LEADING_NUMBER = /^\s*(\d[\d\s]*(?:[.,]\d+)?)/;

export function parseAmountCents(text: string): number | null {
  const m = LEADING_NUMBER.exec(text);
  if (!m) return null;
  const normalized = m[1].replace(/\s+/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parser.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts test/parser.test.ts
git commit -m "feat: leading-amount parser returning integer cents"
```

---

## Task 4: Date / month-bucket helpers

**Files:**
- Create: `src/dates.ts`, `test/dates.test.ts`

**Interfaces:**
- Produces:
  - `interface MonthBucket { year: number; month: number }` (month is 1..12)
  - `function bucketFromUtc(utcISO: string, timezone: string): MonthBucket`
  - `function currentBucket(timezone: string, now?: DateTime): MonthBucket`
  - `function previousBucket(timezone: string, now?: DateTime): MonthBucket`
  - `function nowUtcISO(): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { bucketFromUtc, currentBucket, previousBucket } from '../src/dates';

describe('month buckets', () => {
  const jan = DateTime.fromISO('2026-01-15T12:00:00Z', { zone: 'utc' });

  it('currentBucket reads year/month in the timezone', () => {
    expect(currentBucket('Europe/Kyiv', jan)).toEqual({ year: 2026, month: 1 });
  });
  it('previousBucket wraps across the year boundary', () => {
    expect(previousBucket('Europe/Kyiv', jan)).toEqual({ year: 2025, month: 12 });
  });
  it('bucketFromUtc respects the timezone offset at month edges', () => {
    // 30 June 22:30 UTC is 1 July 01:30 in Kyiv (summer, +3)
    expect(bucketFromUtc('2026-06-30T22:30:00Z', 'Europe/Kyiv')).toEqual({ year: 2026, month: 7 });
    // same instant in UTC bucket stays in June
    expect(bucketFromUtc('2026-06-30T22:30:00Z', 'UTC')).toEqual({ year: 2026, month: 6 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dates.test.ts`
Expected: FAIL — cannot find module `../src/dates`.

- [ ] **Step 3: Write the implementation**

```ts
import { DateTime } from 'luxon';

export interface MonthBucket {
  year: number;
  month: number;
}

function toBucket(dt: DateTime): MonthBucket {
  return { year: dt.year, month: dt.month };
}

export function bucketFromUtc(utcISO: string, timezone: string): MonthBucket {
  return toBucket(DateTime.fromISO(utcISO, { zone: 'utc' }).setZone(timezone));
}

export function currentBucket(timezone: string, now: DateTime = DateTime.utc()): MonthBucket {
  return toBucket(now.setZone(timezone));
}

export function previousBucket(timezone: string, now: DateTime = DateTime.utc()): MonthBucket {
  return toBucket(now.setZone(timezone).minus({ months: 1 }));
}

export function nowUtcISO(): string {
  return DateTime.utc().toISO()!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dates.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts test/dates.test.ts
git commit -m "feat: timezone-aware month bucket helpers"
```

---

## Task 5: Balance calculation

**Files:**
- Create: `src/balance.ts`, `test/balance.test.ts`

**Interfaces:**
- Produces:
  - `interface ExpenseRow { userId: number; amountCents: number }`
  - `interface BalanceResult { user1Cents: number; user2Cents: number; totalCents: number; debtorId: number | null; creditorId: number | null; owedCents: number }`
  - `function computeBalance(user1Id: number, user2Id: number, rows: ExpenseRow[]): BalanceResult`
  - The debtor is the one who paid **less** (must compensate); the creditor paid **more**.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/balance.test.ts`
Expected: FAIL — cannot find module `../src/balance`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/balance.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/balance.ts test/balance.test.ts
git commit -m "feat: 50/50 balance computation with debtor/creditor"
```

---

## Task 6: Formatting (Ukrainian)

**Files:**
- Create: `src/format.ts`, `test/format.test.ts`

**Interfaces:**
- Consumes: `Participant` (from `config`), `MonthBucket` (from `dates`), `BalanceResult` (from `balance`).
- Produces:
  - `const MONTHS: string[]` (12 lowercase Ukrainian month names)
  - `function monthNameLower(month: number): string`
  - `function monthNameUpper(month: number): string`
  - `function formatHryvnia(cents: number): string`
  - `function formatBalance(bucket: MonthBucket, user1: Participant, user2: Participant, balance: BalanceResult): string`
  - `function formatToPreviousConfirmation(month: number, cents: number): string`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL — cannot find module `../src/format`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: Ukrainian formatting for balances, months, and confirmations"
```

---

## Task 7: SQLite persistence

**Files:**
- Create: `src/db.ts`, `test/db.test.ts`

**Interfaces:**
- Consumes: `ExpenseRow` (from `balance`).
- Produces:
  - `type Db = Database.Database`
  - `function openDb(path: string): Db` (creates parent dir, runs `migrate`)
  - `function migrate(db: Db): void`
  - `interface InsertExpenseInput { chatId; messageId; userId; userName; amountCents; description; year; month; createdAtUtc; source: 'message' | 'to_previous' }`
  - `function insertExpense(db: Db, input: InsertExpenseInput): boolean` (false if `(chatId, messageId)` already exists)
  - `function getExpensesForBucket(db: Db, chatId: number, year: number, month: number): ExpenseRow[]`
  - `function setMeta(db: Db, key: string, value: string): void`
  - `function getMeta(db: Db, key: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — cannot find module `../src/db`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/db.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/db.test.ts
git commit -m "feat: SQLite persistence with dedupe and meta store"
```

---

## Task 8: Service layer

**Files:**
- Create: `src/service.ts`, `test/service.test.ts`

**Interfaces:**
- Consumes: `Config` (config), `Db` + `insertExpense`/`getExpensesForBucket` (db), `parseAmountCents` (parser), `bucketFromUtc`/`previousBucket`/`currentBucket`/`nowUtcISO` (dates), `computeBalance` (balance), `formatBalance`/`formatToPreviousConfirmation` (format).
- Produces:
  - `interface IncomingMessage { chatId: number; messageId: number; userId: number; text: string; dateUnix: number }`
  - `type ExpenseOutcome = 'ignored' | 'accounted' | 'duplicate'`
  - `function handleExpenseMessage(db: Db, config: Config, msg: IncomingMessage): ExpenseOutcome`
  - `interface ToPreviousResult { reply: string; stored: boolean }`
  - `function handleToPrevious(db: Db, config: Config, msg: IncomingMessage, argsText: string): ToPreviousResult`
  - `function buildBalanceReport(db: Db, config: Config, chatId: number, which: 'current' | 'previous'): string`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL — cannot find module `../src/service`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/service.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/service.ts test/service.test.ts
git commit -m "feat: service layer orchestrating parse/store/report"
```

---

## Task 9: Month banner image

**Files:**
- Create: `src/banner.ts`, `test/banner.test.ts`

**Interfaces:**
- Consumes: `monthNameUpper` (format).
- Produces: `function renderMonthBanner(month: number, year: number): Promise<Buffer>` — a PNG (1200×600) with the uppercase month name and year.

**Note:** SVG-text rendering via sharp depends on system fonts. The test asserts the PNG is well-formed and correctly sized (the background rect always renders), not glyph pixels. The scheduler (Task 11) wraps the send in a try/catch with a text fallback, so a font failure in production degrades gracefully rather than crashing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { renderMonthBanner } from '../src/banner';

describe('renderMonthBanner', () => {
  it('produces a 1200x600 PNG buffer', async () => {
    const buf = await renderMonthBanner(6, 2026);
    // PNG signature
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/banner.test.ts`
Expected: FAIL — cannot find module `../src/banner`.

- [ ] **Step 3: Write the implementation**

```ts
import sharp from 'sharp';
import { monthNameUpper } from './format';

export async function renderMonthBanner(month: number, year: number): Promise<Buffer> {
  const title = `${monthNameUpper(month)} ${year}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
  <rect width="1200" height="600" fill="#1b2a4a"/>
  <text x="600" y="330" text-anchor="middle"
        font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="150" font-weight="bold" fill="#ffffff">${title}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/banner.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/banner.ts test/banner.test.ts
git commit -m "feat: monthly PNG banner via sharp+svg"
```

---

## Task 10: Monthly scheduler

**Files:**
- Create: `src/scheduler.ts`, `test/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `const MONTHLY_CRON = '0 0 1 * *'`
  - `function scheduleMonthlyBanner(timezone: string, onFire: () => Promise<void>, cronExpr?: string): ReturnType<typeof cron.schedule>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import cron from 'node-cron';
import { MONTHLY_CRON, scheduleMonthlyBanner } from '../src/scheduler';

describe('scheduler', () => {
  it('uses a valid monthly cron expression', () => {
    expect(cron.validate(MONTHLY_CRON)).toBe(true);
  });
  it('returns a stoppable task', () => {
    const task = scheduleMonthlyBanner('Europe/Kyiv', async () => {});
    expect(typeof task.stop).toBe('function');
    task.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scheduler.test.ts`
Expected: FAIL — cannot find module `../src/scheduler`.

- [ ] **Step 3: Write the implementation**

```ts
import cron from 'node-cron';

export const MONTHLY_CRON = '0 0 1 * *'; // 00:00 on the 1st of every month

export function scheduleMonthlyBanner(
  timezone: string,
  onFire: () => Promise<void>,
  cronExpr: string = MONTHLY_CRON,
): ReturnType<typeof cron.schedule> {
  return cron.schedule(cronExpr, () => { void onFire(); }, { timezone });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scheduler.test.ts`
Expected: PASS — 2 tests.

If `import cron from 'node-cron'` causes a runtime/type error, change both the test and source to `import * as cron from 'node-cron'`.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts test/scheduler.test.ts
git commit -m "feat: monthly cron scheduler"
```

---

## Task 11: Telegram bot wiring (`bot.ts`)

**Files:**
- Create: `src/bot.ts`

**Interfaces:**
- Consumes: `Config` (config), `Db` + `setMeta` (db), `handleExpenseMessage`/`handleToPrevious`/`buildBalanceReport`/`IncomingMessage` (service).
- Produces: `function createBot(config: Config, db: Db): Bot`.

This is thin Telegram glue over the already-tested service layer; it is verified by `typecheck` plus the manual smoke test in Task 12. No new unit test.

- [ ] **Step 1: Write the implementation**

```ts
import { Bot, type Context } from 'grammy';
import type { Config } from './config';
import type { Db } from './db';
import { setMeta } from './db';
import {
  handleExpenseMessage,
  handleToPrevious,
  buildBalanceReport,
  type IncomingMessage,
} from './service';

function incoming(ctx: Context): IncomingMessage | null {
  const m = ctx.message;
  if (!m || !ctx.from || !ctx.chat) return null;
  return {
    chatId: ctx.chat.id,
    messageId: m.message_id,
    userId: ctx.from.id,
    text: m.text ?? '',
    dateUnix: m.date,
  };
}

export function createBot(config: Config, db: Db): Bot {
  const bot = new Bot(config.botToken);

  // Remember the group chat so the monthly banner knows where to post.
  bot.use(async (ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      setMeta(db, 'group_chat_id', String(ctx.chat.id));
    }
    await next();
  });

  bot.command('balance', async (ctx) => {
    if (!ctx.chat) return;
    await ctx.reply(buildBalanceReport(db, config, ctx.chat.id, 'current'));
  });

  bot.command('balance_previous', async (ctx) => {
    if (!ctx.chat) return;
    await ctx.reply(buildBalanceReport(db, config, ctx.chat.id, 'previous'));
  });

  bot.command('to_previous', async (ctx) => {
    const msg = incoming(ctx);
    if (!msg) return;
    const result = handleToPrevious(db, config, msg, ctx.match ?? '');
    await ctx.reply(result.reply);
  });

  // Any non-command text whose first token is a number is an expense.
  bot.on('message:text', async (ctx) => {
    const msg = incoming(ctx);
    if (!msg) return;
    if (handleExpenseMessage(db, config, msg) === 'accounted') {
      try {
        await ctx.react('✅');
      } catch {
        await ctx.reply('✅ Враховано');
      }
    }
  });

  return bot;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors. (If grammY's `ctx.react` is flagged, ensure grammy is `^1.44`; `react` is available there.)

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: grammY bot handlers for commands and expense messages"
```

---

## Task 12: Entrypoint, command menu, banner scheduling (`index.ts`)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig` (config), `openDb`/`getMeta` (db), `createBot` (bot), `scheduleMonthlyBanner` (scheduler), `renderMonthBanner` (banner), `currentBucket` (dates), `monthNameUpper` (format), `InputFile` (grammy).

- [ ] **Step 1: Write the implementation**

```ts
import 'dotenv/config';
import { InputFile } from 'grammy';
import { loadConfig } from './config';
import { openDb, getMeta } from './db';
import { createBot } from './bot';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { currentBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const bot = createBot(config, db);

  await bot.api.setMyCommands([
    { command: 'balance', description: 'Баланс за поточний місяць' },
    { command: 'balance_previous', description: 'Баланс за попередній місяць' },
    { command: 'to_previous', description: 'Додати витрату в попередній місяць' },
  ]);

  scheduleMonthlyBanner(config.timezone, async () => {
    const chatId = getMeta(db, 'group_chat_id');
    if (!chatId) {
      console.warn('No group chat id stored yet; skipping monthly banner.');
      return;
    }
    const bucket = currentBucket(config.timezone);
    try {
      const png = await renderMonthBanner(bucket.month, bucket.year);
      await bot.api.sendPhoto(Number(chatId), new InputFile(png, `${bucket.year}-${bucket.month}.png`));
    } catch (err) {
      console.error('Banner render/send failed; sending text fallback:', err);
      await bot.api.sendMessage(
        Number(chatId),
        `📅 *${monthNameUpper(bucket.month)} ${bucket.year}* 📅`,
        { parse_mode: 'Markdown' },
      );
    }
  });

  bot.catch((err) => console.error('Bot error:', err));
  console.log('Bot started.');
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: PASS — all suites (config, parser, dates, balance, format, db, service, banner, scheduler, smoke).

- [ ] **Step 4: Manual smoke test**

Prerequisites: create a real bot with `@BotFather`, get its token; get both Telegram numeric user IDs (from `@userinfobot`); create `.env` from `.env.example` with real values; add the bot to a test group; in `@BotFather` disable group privacy mode (so the bot sees all messages) OR rely on commands.

Run: `npm start`
Verify:
1. Post `4000 гривень Ігорю на місяць` from user 1 → bot reacts ✅, message stored.
2. Post `1000 на одяг` from user 2 → ✅.
3. `/balance` → table shows `Сергій: 4000 ₴`, `Марина: 1000 ₴`, `Разом: 5000 ₴`, `Марина має компенсувати Сергію: 1500 ₴`.
4. `/to_previous 300 Максу на бутерброд` → reply `↩️ Зараховано в <минулий місяць>: 300 ₴`.
5. `/balance_previous` → previous-month table includes the 300 ₴ entry.
6. Re-send an identical expense (forwarded/duplicate update) → not double-counted.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: entrypoint with command menu and monthly banner scheduling"
```

---

## Task 13: Documentation

**Files:**
- Create: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write `README.md`**

````markdown
# Money for Kids — Telegram Bot

Tracks kids' expenses for two co-parents in a shared Telegram group, marks each
accounted message with ✅, and reports monthly 50/50 balances.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Get both participants' numeric Telegram IDs (e.g. via [@userinfobot](https://t.me/userinfobot)).
3. `cp .env.example .env` and fill in `BOT_TOKEN`, `USER1_ID` (Сергій), `USER2_ID` (Марина).
4. `npm install`
5. In @BotFather, disable the bot's group privacy so it can read all group messages.
6. Add the bot to your group.

## Run

- `npm start` — start the bot (long polling).
- `npm run dev` — start with auto-reload.
- `npm test` — run the test suite.
- `npm run typecheck` — type-check without emitting.

## Usage

- Any message starting with a number is logged as an expense by its sender and
  marked ✅. Example: `4000 гривень Ігорю на місяць`.
- `/balance` — totals and who-owes-whom for the current month.
- `/balance_previous` — same for the previous month (includes `/to_previous` entries).
- `/to_previous <сума> <опис>` — log an expense into the previous month, e.g.
  `/to_previous 300 Максу на бутерброд`.
- On the 1st of each month the bot posts a banner image with the month name.

## Notes

- Money is stored in integer cents in a local SQLite file (`DB_PATH`, default
  `./data/expenses.db`). Back up by copying that file.
- Timezone defaults to `Europe/Kyiv` (`TIMEZONE` env).
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage"
```

---

## Final verification

- [ ] Run `npm test` — all suites pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Manual smoke test (Task 12, Step 4) confirms reactions, balances, back-dating, and dedupe.
