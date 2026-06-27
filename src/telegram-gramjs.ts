import { TelegramClient, Api, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { CustomFile } from 'telegram/client/uploads';
import type { TelegramGateway, HistoryMessage } from './gateway';
import type { Config } from './config';
import type { IncomingEvent } from './handlers';
import { THUMBS_UP } from './reconcile';

type UpdateHandler = (kind: 'new' | 'edit', ev: IncomingEvent) => Promise<void>;

function senderIdOf(message: Api.Message): number {
  // Private/group messages: fromId is a PeerUser.
  const from = message.fromId;
  if (from instanceof Api.PeerUser) return Number(from.userId);
  return 0; // anonymous/channel posts are not participants
}

function hasOurReaction(message: Api.Message, thumbsUp: string): boolean {
  const reactions = message.reactions;
  if (!reactions || !reactions.results) return false;
  return reactions.results.some(
    (r) =>
      r.chosenOrder !== undefined &&
      r.chosenOrder !== null &&
      r.reaction instanceof Api.ReactionEmoji &&
      r.reaction.emoticon === thumbsUp,
  );
}

export async function createGateway(config: Config): Promise<{
  gateway: TelegramGateway;
  client: TelegramClient;
  onUpdate(handler: UpdateHandler): void;
}> {
  const client = new TelegramClient(
    new StringSession(config.sessionString),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.connect();

  const peer = await client.getInputEntity(config.groupChatId);

  const gateway: TelegramGateway = {
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
          hasOurReaction: hasOurReaction(m, THUMBS_UP),
        });
      }
      return out;
    },
    async setReaction(_chatId, messageId, emoji) {
      await client.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: messageId,
          reaction: emoji ? [new Api.ReactionEmoji({ emoticon: emoji })] : [],
        }),
      );
    },
    async sendMessage(_chatId, text) {
      await client.sendMessage(peer, { message: text });
    },
    async sendPhoto(_chatId, png, filename) {
      await client.sendFile(peer, {
        file: new CustomFile(filename, png.length, '', png),
      });
    },
  };

  function onUpdate(handler: UpdateHandler): void {
    client.addEventHandler(async (update: Api.TypeUpdate) => {
      const isNew =
        update instanceof Api.UpdateNewMessage ||
        update instanceof Api.UpdateNewChannelMessage;
      const isEdit =
        update instanceof Api.UpdateEditMessage ||
        update instanceof Api.UpdateEditChannelMessage;
      if (!isNew && !isEdit) return;
      const message = (update as { message: Api.TypeMessage }).message;
      if (!(message instanceof Api.Message)) return;
      // Drop updates from chats other than the configured group.
      if (utils.getPeerId(message.peerId) !== String(config.groupChatId)) return;
      const ev: IncomingEvent = {
        senderId: senderIdOf(message),
        messageId: message.id,
        text: message.message ?? '',
        dateUnix: message.date,
      };
      await handler(isNew ? 'new' : 'edit', ev);
    });
  }

  return { gateway, client, onUpdate };
}
