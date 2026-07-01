import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { createInterface } from 'node:readline/promises';
import qrcode from 'qrcode-terminal';

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.API_ID ?? '', 10);
  const apiHash = process.env.API_HASH ?? '';
  if (!Number.isInteger(apiId) || apiHash === '') {
    throw new Error('Set API_ID and API_HASH in .env before running login.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();

  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async (code) => {
        const url = `tg://login?token=${code.token.toString('base64url')}`;
        console.log('\nScan this QR in Telegram on the ledger account:');
        console.log('  Settings → Devices → Link Desktop Device\n');
        qrcode.generate(url, { small: true });
        console.log('\n(Waiting for the scan — the QR refreshes itself until you do.)');
      },
      password: async () => rl.question('2FA password (blank if none): '),
      onError: async (err) => {
        console.error(err);
        return true;
      },
    },
  );

  console.log('\nTELEGRAM_SESSION=' + (client.session.save() as unknown as string));
  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
