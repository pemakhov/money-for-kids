import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { HistoryGateway, HistoryMessage } from './gateway';
import type { Config } from './config';
import { THUMBS_UP } from './reconcile';

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

export async function createHistoryGateway(
  config: Config,
  botUserId: number,
): Promise<{ historyGateway: HistoryGateway; client: TelegramClient }> {
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.connect();

  const peer = await client.getInputEntity(config.groupChatId);

  const historyGateway: HistoryGateway = {
    async fetchHistory(_chatId, sinceUnix) {
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
    },
  };

  return { historyGateway, client };
}
