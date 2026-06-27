import 'dotenv/config';
import { loadConfig } from './config';
import { createGateway } from './telegram-gramjs';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { previousBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const { gateway, onUpdate } = await createGateway(config);
  const chatId = config.groupChatId;

  // Catch up on anything missed while offline (settles previous + current month).
  await reconcileBalance(gateway, config, chatId, 'previous');

  onUpdate(async (kind, ev) => {
    try {
      if (kind === 'new') await onNewMessage(gateway, config, chatId, ev);
      else await onEditedMessage(gateway, config, chatId, ev);
    } catch (err) {
      console.error('Update handler failed:', err);
    }
  });

  scheduleMonthlyBanner(config.timezone, async () => {
    // Settle the just-ended month, then post its banner.
    const bucket = previousBucket(config.timezone);
    await reconcileBalance(gateway, config, chatId, 'previous');
    try {
      const png = await renderMonthBanner(bucket.month, bucket.year);
      await gateway.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
    } catch (err) {
      console.error('Banner render/send failed; sending text fallback:', err);
      try {
        await gateway.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
      } catch (fallbackErr) {
        console.error('Banner text fallback also failed:', fallbackErr);
      }
    }
  });

  console.log('Ledger account started.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
