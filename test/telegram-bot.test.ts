import { describe, it, expect } from 'vitest';
import {
  API_TIMEOUT_SECONDS,
  POLL_STALL_MS,
  POLL_TIMEOUT_SECONDS,
  normalizeCommand,
} from '../src/telegram-bot';
import { HEALTH_RECOVER_INTERVAL_MS } from '../src/watchdog';

describe('normalizeCommand', () => {
  it('strips @botusername from a bare command', () => {
    expect(normalizeCommand('/balance@MoneyForKidsBot', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('strips @botusername but keeps arguments', () => {
    expect(normalizeCommand('/to_previous@MoneyForKidsBot 300 x', 'MoneyForKidsBot'))
      .toBe('/to_previous 300 x');
  });

  it('is case-insensitive on the username', () => {
    expect(normalizeCommand('/balance@moneyforkidsbot', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('leaves a plain command untouched', () => {
    expect(normalizeCommand('/balance', 'MoneyForKidsBot')).toBe('/balance');
  });

  it('leaves a non-command expense untouched', () => {
    expect(normalizeCommand('500 грн', 'MoneyForKidsBot')).toBe('500 грн');
  });
});

// The livelock these bounds prevent: the watchdog repairs sick polling by
// dropping sockets, which aborts the long poll in flight. If the staleness
// window were tighter than one whole poll cycle, the poll could never finish
// before the next repair killed it, and the bot would restart itself for ever.
describe('poll liveness bounds', () => {
  const GRAMMY_RETRY_PAUSE_MS = 3_000;

  it('allows a full request timeout plus grammy\'s retry pause', () => {
    expect(POLL_STALL_MS).toBeGreaterThan(API_TIMEOUT_SECONDS * 1000 + GRAMMY_RETRY_PAUSE_MS);
  });

  it('gives the request timeout room for a whole long poll', () => {
    expect(API_TIMEOUT_SECONDS).toBeGreaterThan(POLL_TIMEOUT_SECONDS);
  });

  it('is repaired less often than a poll cycle takes to complete', () => {
    const pollCycleMs = (API_TIMEOUT_SECONDS + POLL_TIMEOUT_SECONDS) * 1000 + GRAMMY_RETRY_PAUSE_MS;
    expect(HEALTH_RECOVER_INTERVAL_MS).toBeGreaterThan(pollCycleMs);
  });
});
