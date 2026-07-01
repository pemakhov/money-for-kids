import { describe, it, expect } from 'vitest';
import { normalizeCommand } from '../src/telegram-bot';

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
