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
        await ctx.react('👍');
      } catch {
        await ctx.reply('✅ Враховано');
      }
    }
  });

  return bot;
}
