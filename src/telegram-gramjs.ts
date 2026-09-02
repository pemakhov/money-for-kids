import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { HistoryGateway, HistoryMessage } from './gateway';
import type { Config } from './config';
import { THUMBS_UP } from './reconcile';
import { withTimeout } from './watchdog';

/** Cap on a single history read, so a dead reader surfaces instead of hanging. */
export const HISTORY_TIMEOUT_MS = 60_000;
/** Cap on our own wait for a (re)connect; gramjs keeps retrying underneath. */
export const CONNECT_TIMEOUT_MS = 30_000;
/** Cap on tearing a connection down before rebuilding it. */
export const DISCONNECT_TIMEOUT_MS = 10_000;

function senderIdOf(message: Api.Message): number {
  // Private/group messages: fromId is a PeerUser.
  const from = message.fromId;
  if (from instanceof Api.PeerUser) return Number(from.userId);
  return 0; // anonymous/channel posts are not participants
}

// The bot sets 👍, so MTProto can't use chosenOrder (its own reaction view);
// it must find the bot's peer in the per-peer recentReactions list.
// WHY: recentReactions is a bounded recent-reactors window that Telegram may
// truncate or return empty; it does not affect balance TOTALS (those come
// from classify), but if the bot's peer falls out of the window, a stale 👍
// may not get cleared by reconcile.
export function botReactedThumbsUp(
  reactions: Api.MessageReactions | undefined,
  botUserId: number,
  emoji: string,
): boolean {
  const recent = reactions?.recentReactions;
  if (!recent) return false;
  return recent.some(
    (r) =>
      r.peerId instanceof Api.PeerUser &&
      Number(r.peerId.userId) === botUserId &&
      r.reaction instanceof Api.ReactionEmoji &&
      r.reaction.emoticon === emoji,
  );
}

export interface HistoryRuntime {
  historyGateway: HistoryGateway;
  client: TelegramClient;
  /** True while the MTProto sender holds a live connection. */
  isConnected(): boolean;
  /** Revives the sender if it dropped; a no-op when already connected. */
  ensureConnected(): Promise<void>;
  /**
   * Tears the connection down and builds a new one.
   *
   * WHY: after a sleep the sender still reports itself connected over a socket
   * that is long dead, so `ensureConnected` would decide there is nothing to
   * do. When we already know the connection is stale, rebuild rather than ask.
   */
  reconnect(): Promise<void>;
}

export async function createHistoryGateway(
  config: Config,
  botUserId: number,
): Promise<HistoryRuntime> {
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    {
      // WHY: a finite count bricks the reader permanently. gramjs reconnects by
      // disconnecting first, and its retry loop leaves the sender marked
      // disconnected once the attempts run out — after which every later
      // reconnect() call is a no-op and only a process restart helps. A laptop
      // wake reliably burns a handful of attempts while Wi-Fi reassociates, so
      // the count must not be exhaustible.
      connectionRetries: Infinity,
      retryDelay: 2_000,
      autoReconnect: true,
    },
  );
  await client.connect();

  const peer = await client.getInputEntity(config.groupChatId);

  // One connect at a time: the retry loop above can run for minutes, and a
  // second caller must join that attempt rather than start a rival one.
  let connecting: Promise<unknown> | undefined;
  function ensureConnected(): Promise<void> {
    if (client.connected) return Promise.resolve();
    connecting ??= client.connect().finally(() => { connecting = undefined; });
    return withTimeout(connecting, CONNECT_TIMEOUT_MS, 'MTProto connect').then(() => {});
  }

  async function reconnect(): Promise<void> {
    await withTimeout(client.disconnect(), DISCONNECT_TIMEOUT_MS, 'MTProto disconnect').catch(
      (err) => console.warn('MTProto disconnect failed; reconnecting anyway:', err),
    );
    await ensureConnected();
  }

  const historyGateway: HistoryGateway = {
    async fetchHistory(_chatId, sinceUnix) {
      await ensureConnected();
      return withTimeout(readHistory(sinceUnix), HISTORY_TIMEOUT_MS, 'MTProto history read');
    },
  };

  async function readHistory(sinceUnix: number): Promise<HistoryMessage[]> {
    const out: HistoryMessage[] = [];
    for await (const m of client.iterMessages(peer, { limit: 1000 })) {
      if (typeof m.date === 'number' && m.date < sinceUnix) break;
      if (!(m instanceof Api.Message)) continue;
      out.push({
        messageId: m.id,
        senderId: senderIdOf(m),
        text: m.message ?? '',
        dateUnix: m.date,
        hasBotReaction: botReactedThumbsUp(m.reactions, botUserId, THUMBS_UP),
      });
    }
    return out;
  }

  return {
    historyGateway,
    client,
    isConnected: () => Boolean(client.connected),
    ensureConnected,
    reconnect,
  };
}
