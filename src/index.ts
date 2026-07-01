import 'dotenv/config';
import { loadConfig } from './config';
import { createHistoryGateway } from './telegram-gramjs';
import { createBotGateway } from './telegram-bot';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { postMonthBanner } from './banner';
import { previousBucket } from './dates';

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
      await postMonthBanner(botGateway, chatId, bucket);
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
