import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  API_ID: '12345', API_HASH: 'abcdef', TELEGRAM_SESSION: 'sess',
  GROUP_CHAT_ID: '-1001234567890', USER1_ID: '111', USER2_ID: '222',
  TIMEZONE: 'Europe/Kyiv', BOT_TOKEN: 'bottoken',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('loads MTProto fields, ids, and fixed Ukrainian names', () => {
    const c = loadConfig(base);
    expect(c.apiId).toBe(12345);
    expect(c.apiHash).toBe('abcdef');
    expect(c.sessionString).toBe('sess');
    expect(c.groupChatId).toBe(-1001234567890);
    expect(c.user1).toEqual({ id: 111, nominative: 'Сергій', dative: 'Сергію' });
    expect(c.user2).toEqual({ id: 222, nominative: 'Марина', dative: 'Марині' });
    expect(c.timezone).toBe('Europe/Kyiv');
    expect(c.botToken).toBe('bottoken');
  });

  it('defaults timezone when absent', () => {
    const c = loadConfig({ ...base, TIMEZONE: undefined } as NodeJS.ProcessEnv);
    expect(c.timezone).toBe('Europe/Kyiv');
  });

  it('throws when API_ID is missing', () => {
    const { API_ID, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/API_ID/);
  });

  it('throws when BOT_TOKEN is missing', () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/BOT_TOKEN/);
  });

  it('throws when GROUP_CHAT_ID is not an integer', () => {
    expect(() => loadConfig({ ...base, GROUP_CHAT_ID: 'xyz' })).toThrow(/GROUP_CHAT_ID/);
  });
});
