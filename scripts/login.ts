import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { createInterface } from 'node:readline/promises';

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.API_ID ?? '', 10);
  const apiHash = process.env.API_HASH ?? '';
  if (!Number.isInteger(apiId) || apiHash === '') {
    throw new Error('Set API_ID and API_HASH in .env before running login.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => rl.question('Phone number (with country code): '),
    password: async () => rl.question('2FA password (blank if none): '),
    phoneCode: async () => rl.question('Login code from Telegram: '),
    onError: (err) => console.error(err),
  });

  console.log('\nTELEGRAM_SESSION=' + (client.session.save() as unknown as string));
  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
