import 'dotenv/config';
import { loadConfig } from './config';
import { createHistoryGateway } from './telegram-gramjs';
import { createBotGateway } from './telegram-bot';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { previousBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const chatId = config.groupChatId;

  const { botGateway, bot, botUserId, onUpdate } = await createBotGateway(config);
  const { historyGateway } = await createHistoryGateway(config, botUserId);

  // Catch up on anything missed while offline (settles previous + current month).
  try {
    await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
  } catch (err) {
    console.warn('Startup reconcile failed; continuing:', err);
  }

  onUpdate(async (kind, ev) => {
    try {
      if (kind === 'new') await onNewMessage(historyGateway, botGateway, config, chatId, ev);
      else await onEditedMessage(botGateway, config, chatId, ev);
    } catch (err) {
      console.error(`Update handler failed (kind=${kind}, messageId=${ev.messageId}):`, err);
    }
  });

  scheduleMonthlyBanner(config.timezone, async () => {
    try {
      // Settle the just-ended month, then post its banner.
      const bucket = previousBucket(config.timezone);
      await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
      try {
        const png = await renderMonthBanner(bucket.month, bucket.year);
        await botGateway.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
      } catch (err) {
        console.error('Banner render/send failed; sending text fallback:', err);
        try {
          await botGateway.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
        } catch (fallbackErr) {
          console.error('Banner text fallback also failed:', fallbackErr);
        }
      }
    } catch (err) {
      console.error('Monthly banner cron failed:', err);
    }
  });

  await bot.start({ onStart: () => console.log('Ledger bot started.') });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
