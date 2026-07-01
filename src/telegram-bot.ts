import { Bot, InputFile, Context } from 'grammy';
import type { ReactionType, ReactionTypeEmoji } from 'grammy/types';
import type { BotGateway } from './gateway';
import type { Config } from './config';
import type { IncomingEvent } from './handlers';

type UpdateHandler = (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>;

const COMMANDS = [
  { command: 'balance', description: 'Баланс за поточний місяць' },
  { command: 'balance_previous', description: 'Баланс за попередній місяць' },
  { command: 'to_previous', description: 'Витрата в попередній місяць: /to_previous <сума> <опис>' },
];

// In groups Telegram appends @botusername to commands; strip it so exact
// command matching and argument parsing in handlers/classify still work.
export function normalizeCommand(text: string, botUsername: string): string {
  return text.replace(
    new RegExp(`^(/[A-Za-z0-9_]+)@${botUsername}\\b`, 'i'),
    '$1',
  );
}

function toEvent(ctx: Context, botUsername: string): IncomingEvent {
  const msg = ctx.msg;
  return {
    senderId: ctx.from?.id ?? 0,
    messageId: msg?.message_id ?? 0,
    text: normalizeCommand(msg?.text ?? '', botUsername),
    dateUnix: msg?.date ?? 0,
  };
}

export async function createBotGateway(config: Config): Promise<{
  botGateway: BotGateway;
  bot: Bot;
  botUserId: number;
  onUpdate(handler: UpdateHandler): void;
}> {
  const bot = new Bot(config.botToken);
  await bot.init();
  const botUserId = bot.botInfo.id;
  const botUsername = bot.botInfo.username;

  await bot.api.setMyCommands(COMMANDS);

  const botGateway: BotGateway = {
    async setReaction(chatId, messageId, emoji) {
      // grammy types emoji as a literal union; BotGateway intentionally widens it to
      // string for transport decoupling, and callers only ever pass real reaction emoji (THUMBS_UP).
      const reaction: ReactionType[] = emoji
        ? [{ type: 'emoji', emoji: emoji as ReactionTypeEmoji['emoji'] }]
        : [];
      await bot.api.setMessageReaction(chatId, messageId, reaction);
    },
    async sendMessage(chatId, text) {
      await bot.api.sendMessage(chatId, text);
    },
    async sendPhoto(chatId, png, filename) {
      await bot.api.sendPhoto(chatId, new InputFile(png, filename));
    },
  };

  function onUpdate(handler: UpdateHandler): void {
    bot.on('message:text', async (ctx) => {
      if (ctx.chat.id !== config.groupChatId) return;
      await handler('new', toEvent(ctx, botUsername));
    });
    bot.on('edited_message:text', async (ctx) => {
      if (ctx.chat.id !== config.groupChatId) return;
      await handler('edit', toEvent(ctx, botUsername));
    });
  }

  return { botGateway, bot, botUserId, onUpdate };
}
