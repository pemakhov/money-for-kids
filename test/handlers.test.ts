import { describe, it, expect } from 'vitest';
import { onNewMessage, onEditedMessage } from '../src/handlers';
import { THUMBS_UP } from '../src/reconcile';
import type { HistoryGateway, BotGateway, HistoryMessage } from '../src/gateway';
import { currentBucket } from '../src/dates';
import type { Config } from '../src/config';

const config: Config = {
  apiId: 1, apiHash: 'h', sessionString: 's', botToken: 'b', groupChatId: -100,
  user1: { id: 1, nominative: 'Сергій', dative: 'Сергію' },
  user2: { id: 2, nominative: 'Марина', dative: 'Марині' },
  timezone: 'Europe/Kyiv',
};
const t = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000);

function fake(history: HistoryMessage[] = []) {
  const reactions: { messageId: number; emoji: string | null }[] = [];
  const sent: string[] = [];
  const historyGw: HistoryGateway = {
    async fetchHistory() { return history; },
  };
  const bot: BotGateway = {
    async setReaction(_c, messageId, emoji) { reactions.push({ messageId, emoji }); },
    async sendMessage(_c, text) { sent.push(text); },
    async sendPhoto() {},
  };
  return { historyGw, bot, reactions, sent };
}

describe('onNewMessage', () => {
  it('reacts 👍 to a participant expense', async () => {
    const { historyGw, bot, reactions } = fake();
    await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 7, text: '500', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 7, emoji: THUMBS_UP });
  });

  it('ignores a non-participant', async () => {
    const { historyGw, bot, reactions, sent } = fake();
    await onNewMessage(historyGw, bot, config, -100, { senderId: 999, messageId: 8, text: '500', dateUnix: t });
    expect(reactions).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('reacts and confirms a valid /to_previous', async () => {
    const { historyGw, bot, reactions, sent } = fake();
    await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 9, text: '/to_previous 300 x', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 9, emoji: THUMBS_UP });
    expect(sent.some((s) => s.includes('Зараховано'))).toBe(true);
  });

  it('replies with usage help for a /to_previous without amount', async () => {
    const { historyGw, bot, reactions, sent } = fake();
    await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 10, text: '/to_previous oops', dateUnix: t });
    expect(reactions).toEqual([]);
    expect(sent.some((s) => s.includes('/to_previous'))).toBe(true);
  });

  it('replies to /help with usage info', async () => {
    const { historyGw, bot, reactions, sent } = fake();
    await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 14, text: '/help', dateUnix: t });
    expect(reactions).toEqual([]);
    expect(sent.some((s) => s.includes('/balance') && s.includes('/to_previous'))).toBe(true);
  });

  it('replies to /balance with a reconciled report', async () => {
    const cur = currentBucket(config.timezone);
    const curT = Math.floor(Date.UTC(cur.year, cur.month - 1, 15, 12, 0, 0) / 1000);
    const { historyGw, bot, sent } = fake([
      { messageId: 1, senderId: 1, text: '4000', dateUnix: curT, hasBotReaction: true },
    ]);
    await onNewMessage(historyGw, bot, config, -100, { senderId: 1, messageId: 11, text: '/balance', dateUnix: curT });
    expect(sent.some((s) => s.includes('Сергій: 4000 ₴'))).toBe(true);
  });
});

describe('onEditedMessage', () => {
  it('revokes 👍 when an edit removes the number', async () => {
    const { bot, reactions } = fake();
    await onEditedMessage(bot, config, -100, { senderId: 1, messageId: 12, text: 'lunch', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 12, emoji: null });
  });

  it('adds 👍 when an edit introduces a number', async () => {
    const { bot, reactions } = fake();
    await onEditedMessage(bot, config, -100, { senderId: 1, messageId: 13, text: '250 lunch', dateUnix: t });
    expect(reactions).toContainEqual({ messageId: 13, emoji: THUMBS_UP });
  });
});
