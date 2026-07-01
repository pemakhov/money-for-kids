import { describe, it, expect } from 'vitest';
import { classify } from '../src/classify';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', botToken: 'b', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};
// 10 June 2026 12:00 UTC
const JUNE = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);

describe('classify', () => {
  it('ignores non-participants', () => {
    expect(classify({ senderId: 999, text: '100', dateUnix: JUNE }, config)).toEqual({ kind: 'ignore' });
  });

  it('counts a leading-number message into the message month', () => {
    const c = classify({ senderId: 1, text: '4000 грн', dateUnix: JUNE }, config);
    expect(c).toMatchObject({
      kind: 'count', amountCents: 400000, source: 'message',
      bucket: { year: 2026, month: 6 }, description: '4000 грн',
    });
    expect(c.kind === 'count' && c.participant.id).toBe(1);
  });

  it('marks a participant message without a leading number as not_expense', () => {
    expect(classify({ senderId: 1, text: 'купив зошити', dateUnix: JUNE }, config))
      .toEqual({ kind: 'not_expense' });
  });

  it('counts /to_previous into the previous month with the remainder as description', () => {
    const c = classify({ senderId: 2, text: '/to_previous 300 Максу на бутерброд', dateUnix: JUNE }, config);
    expect(c).toMatchObject({
      kind: 'count', amountCents: 30000, source: 'to_previous',
      bucket: { year: 2026, month: 5 }, description: '300 Максу на бутерброд',
    });
  });

  it('marks /to_previous without an amount as not_expense', () => {
    expect(classify({ senderId: 2, text: '/to_previous просто текст', dateUnix: JUNE }, config))
      .toEqual({ kind: 'not_expense' });
  });
});
