import 'dotenv/config';
import { TelegramClient, Api, utils } from 'telegram';
import { StringSession } from 'telegram/sessions';

// One-shot, IRREVERSIBLE: convert the basic group to a supergroup so the bot and
// the MTProto account share one global message-id space. Run once; then update
// GROUP_CHAT_ID to the printed -100… id everywhere.

function findNewChannel(result: Api.TypeUpdates): Api.Channel | null {
  const chats = 'chats' in result ? result.chats : [];
  for (const c of chats) {
    if (c instanceof Api.Channel) return c;
  }
  return null;
}

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.API_ID ?? '', 10);
  const apiHash = process.env.API_HASH ?? '';
  const session = process.env.TELEGRAM_SESSION ?? '';
  const groupChatId = Number.parseInt(process.env.GROUP_CHAT_ID ?? '', 10);
  if (!Number.isInteger(apiId) || !apiHash || !session || !Number.isInteger(groupChatId)) {
    throw new Error('Need API_ID, API_HASH, TELEGRAM_SESSION, GROUP_CHAT_ID in .env');
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  const entity = await client.getEntity(groupChatId);
  if (!(entity instanceof Api.Chat)) {
    console.log(`Entity is ${entity.className}, not a basic group.`);
    if (entity instanceof Api.Channel) {
      console.log(`Already a supergroup — its id is ${utils.getPeerId(entity)}. Nothing to do.`);
    }
    await client.disconnect();
    process.exit(0);
  }

  console.log(`Migrating basic group "${entity.title}" (chat id ${entity.id})…`);
  const result = await client.invoke(new Api.messages.MigrateChat({ chatId: entity.id }));

  const channel = findNewChannel(result as Api.TypeUpdates);
  if (!channel) {
    console.log('Migration returned no new channel — dumping raw result:');
    console.log(JSON.stringify(result, null, 2));
    await client.disconnect();
    process.exit(1);
  }

  const newId = utils.getPeerId(channel);
  console.log('\n=================== DONE ===================');
  console.log(`✅ Now a supergroup: "${channel.title}"`);
  console.log(`   New GROUP_CHAT_ID → ${newId}`);
  console.log('   Update this in .env (and any running ledger) before restarting.');
  console.log('===========================================');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  console.error('\nIf this says the account lacks rights, the ledger account must be');
  console.error('the group creator/admin to migrate it.');
  process.exit(1);
});
