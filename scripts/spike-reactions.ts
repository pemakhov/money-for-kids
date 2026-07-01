import 'dotenv/config';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';

// Throwaway diagnostic: verify that after the BOT sets 👍 via the Bot API,
// the MTProto history read exposes the bot's peer in `reactions.recentReactions`.
// This is the single assumption the whole bot/MTProto split rests on.

const THUMBS_UP = '👍';

interface BotUser {
  id: number;
  username?: string;
}

interface BotMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
}

async function botCall<T>(token: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Bot API ${method} failed: ${json.description}`);
  return json.result as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function peerUserId(peer: Api.TypePeer | undefined): number | null {
  return peer instanceof Api.PeerUser ? Number(peer.userId) : null;
}

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.API_ID ?? '', 10);
  const apiHash = process.env.API_HASH ?? '';
  const session = process.env.TELEGRAM_SESSION ?? '';
  const token = process.env.BOT_TOKEN ?? '';
  const groupChatId = Number.parseInt(process.env.GROUP_CHAT_ID ?? '', 10);
  if (!Number.isInteger(apiId) || !apiHash || !session || !token || !Number.isInteger(groupChatId)) {
    throw new Error('Need API_ID, API_HASH, TELEGRAM_SESSION, BOT_TOKEN, GROUP_CHAT_ID in .env');
  }

  const bot = await botCall<BotUser>(token, 'getMe', {});
  console.log(`Bot: @${bot.username} (id ${bot.id})`);

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  const peer = await client.getInputEntity(groupChatId);
  const entity = await client.getEntity(peer);
  const mtTitle = 'title' in entity ? (entity as { title?: string }).title : '(no title)';
  console.log(`\nMTProto resolves GROUP_CHAT_ID → ${entity.className} "${mtTitle}"`);

  // A freshly-added bot can't react to messages that predate it, so post a fresh
  // one as the bot and react to that — guaranteed visible and self-contained.
  const sent = await botCall<BotMessage>(token, 'sendMessage', {
    chat_id: groupChatId,
    text: '🔧 reaction-detection spike (safe to ignore/delete)',
  });
  const targetId = sent.message_id;
  console.log(`Bot API posted to    → ${sent.chat.type} "${sent.chat.title}" (chat.id ${sent.chat.id})`);
  console.log(`Bot message_id ${targetId}; reacting to it as the bot…`);

  await botCall(token, 'setMessageReaction', {
    chat_id: groupChatId,
    message_id: targetId,
    reaction: [{ type: 'emoji', emoji: THUMBS_UP }],
  });

  await sleep(2000);

  console.log('\n--- MTProto sees these recent message ids in its chat ---');
  const seenIds: number[] = [];
  let found: Api.Message | null = null;
  for await (const m of client.iterMessages(peer, { limit: 10 })) {
    if (!(m instanceof Api.Message)) continue;
    seenIds.push(m.id);
    if (m.id === targetId) found = m;
  }
  console.log(seenIds.join(', '));

  if (!found) {
    console.log('\n=================== VERDICT ===================');
    console.log(`❌ Bot message_id ${targetId} is NOT in MTProto's chat.`);
    console.log('   The Bot API and MTProto are pointed at DIFFERENT chats.');
    console.log(`   Bot chat.id: ${sent.chat.id}  |  configured GROUP_CHAT_ID: ${groupChatId}`);
    console.log('   → Reconcile the chat id before building. Likely a basic-group');
    console.log('     → supergroup migration; both sides must use the -100 supergroup id.');
    console.log('==============================================');
    await client.disconnect();
    process.exit(0);
  }

  const reactions = found.reactions;
  console.log('\n--- reactions.results (aggregate counts, no peer detail) ---');
  console.log(JSON.stringify(reactions?.results?.map((r) => ({
    emoticon: r.reaction instanceof Api.ReactionEmoji ? r.reaction.emoticon : '(custom)',
    count: r.count,
    chosenOrder: r.chosenOrder,
  })) ?? [], null, 2));

  const recent = reactions?.recentReactions ?? [];
  console.log('\n--- reactions.recentReactions (per-peer detail — the thing we need) ---');
  console.log(JSON.stringify(recent.map((r) => ({
    peerUserId: peerUserId(r.peerId),
    emoticon: r.reaction instanceof Api.ReactionEmoji ? r.reaction.emoticon : '(custom)',
  })), null, 2));

  const botInRecent = recent.some(
    (r) => peerUserId(r.peerId) === bot.id
      && r.reaction instanceof Api.ReactionEmoji
      && r.reaction.emoticon === THUMBS_UP,
  );

  console.log('\n=================== VERDICT ===================');
  if (botInRecent) {
    console.log('✅ Bot peer IS visible in recentReactions.');
    console.log('   → Proceed with peer-id detection as designed.');
  } else if (recent.length === 0) {
    console.log('⚠️  recentReactions is EMPTY but results shows the 👍.');
    console.log('   → Peer detail unavailable on history read. Fall back to');
    console.log('     "👍 present at all" (safe here since only the bot reacts),');
    console.log('     and document it as a known limitation.');
  } else {
    console.log('⚠️  recentReactions present but bot peer NOT found.');
    console.log('   → Inspect the dump above before deciding detection strategy.');
  }
  console.log('==============================================');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
