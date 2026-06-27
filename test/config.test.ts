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
