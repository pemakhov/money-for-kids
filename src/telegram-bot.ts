import { Agent } from 'node:https';
import { Bot, InputFile, Context, HttpError } from 'grammy';
import type { ReactionType, ReactionTypeEmoji } from 'grammy/types';
import type { BotGateway } from './gateway';
import type { Config } from './config';
import type { IncomingEvent } from './handlers';
import { retry } from './watchdog';

type UpdateHandler = (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>;

/** Seconds Telegram holds a `getUpdates` call open when there is nothing to report. */
export const POLL_TIMEOUT_SECONDS = 30;

// WHY: grammy's default is 500s. A long poll issued over a socket that died
// during a laptop sleep never gets an answer, so that default leaves the bot
// deaf for more than eight minutes after the lid opens. Just above the long
// poll itself is the tightest bound that never cuts a healthy request short.
export const API_TIMEOUT_SECONDS = POLL_TIMEOUT_SECONDS + 15;

// A healthy long poll returns at least every POLL_TIMEOUT_SECONDS; anything
// past this means the polling loop is stuck rather than merely idle.
export const POLL_STALL_MS = (POLL_TIMEOUT_SECONDS + 60) * 1000;

/** Backoff for a reaction that failed on the network rather than on the API. */
const REACTION_RETRY_DELAYS_MS = [1_000, 3_000] as const;

const COMMANDS = [
  { command: 'balance', description: 'Баланс за поточний місяць' },
  { command: 'balance_previous', description: 'Баланс за попередній місяць' },
  { command: 'to_previous', description: 'Витрата в попередній місяць: /to_previous <сума> <опис>' },
  { command: 'month', description: 'Банер із назвою поточного місяця' },
  { command: 'help', description: 'Як користуватися ботом' },
];

// In groups Telegram appends @botusername to commands; strip it so exact
// command matching and argument parsing in handlers/classify still work.
// WHY: botUsername is interpolated into the RegExp unescaped, but this is
// safe because Telegram usernames are restricted to [A-Za-z0-9_].
export function normalizeCommand(text: string, botUsername: string): string {
  return text.replace(
    new RegExp(`^(/[A-Za-z0-9_]+)@${botUsername}\\b`, 'i'),
    '$1',
  );
}

// HttpError is grammy's "the request never reached Telegram" error; GrammyError
// means Telegram answered and said no, which retrying cannot fix.
function isNetworkError(err: unknown): boolean {
  return err instanceof HttpError;
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

export interface BotRuntime {
  botGateway: BotGateway;
  bot: Bot;
  botUserId: number;
  onUpdate(handler: UpdateHandler): void;
  /** Starts long polling in the background. `onStopped` fires if it ever ends. */
  startPolling(onStopped: (err: unknown) => void): void;
  /** True while the polling loop is running and answering within its timeout. */
  isPollingHealthy(): boolean;
  /**
   * Closes every pooled HTTPS socket, failing whatever is in flight on them.
   *
   * WHY: node's keep-alive agent happily hands out sockets that a sleep
   * silently killed. Dropping them turns an eight-minute hang into an
   * immediate error, which grammy's polling loop retries within seconds.
   */
  dropStaleSockets(): void;
}

export async function createBotGateway(config: Config): Promise<BotRuntime> {
  // Ours rather than grammy's cached one, so that dropStaleSockets can reach it.
  const agent = new Agent({ keepAlive: true });
  const bot = new Bot(config.botToken, {
    client: {
      timeoutSeconds: API_TIMEOUT_SECONDS,
      baseFetchConfig: { compress: true, agent },
    },
  });

  let lastPollAt = 0;
  bot.api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    if (method === 'getUpdates' && res.ok) lastPollAt = Date.now();
    return res;
  });

  // WHY: grammy's default error handler stops long polling for good. Every
  // handler already catches its own failures; this is the backstop that keeps
  // one unexpected throw from silently taking the bot off the air.
  bot.catch((err) => {
    console.error('Middleware error on update', err.ctx?.update?.update_id, err.error);
  });

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
      // Only the reaction is retried on a network error: setting the same
      // reaction twice is a no-op, whereas a resent message or photo would be
      // a duplicate whenever the first request landed and only its reply was
      // lost — which is exactly what a sleep does to an in-flight call.
      await retry(
        () => bot.api.setMessageReaction(chatId, messageId, reaction),
        REACTION_RETRY_DELAYS_MS,
        isNetworkError,
      );
    },
    async sendMessage(chatId, text) {
      await bot.api.sendMessage(chatId, text);
    },
    async sendPhoto(chatId, png, filename) {
      await bot.api.sendPhoto(chatId, new InputFile(png, filename));
    },
  };

  // WHY: must be called once — it registers listeners per call, and index.ts
  // calls it once.
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

  function startPolling(onStopped: (err: unknown) => void): void {
    lastPollAt = Date.now();
    bot
      .start({
        timeout: POLL_TIMEOUT_SECONDS,
        onStart: () => console.log('Ledger bot started.'),
      })
      .then(() => onStopped(new Error('Long polling ended unexpectedly')), onStopped);
  }

  return {
    botGateway,
    bot,
    botUserId,
    onUpdate,
    startPolling,
    isPollingHealthy: () => bot.isRunning() && Date.now() - lastPollAt < POLL_STALL_MS,
    dropStaleSockets: () => agent.destroy(),
  };
}
