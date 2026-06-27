import 'dotenv/config';
import { InputFile } from 'grammy';
import { loadConfig } from './config';
import { openDb, getMeta } from './db';
import { createBot } from './bot';
import { scheduleMonthlyBanner } from './scheduler';
import { renderMonthBanner } from './banner';
import { currentBucket } from './dates';
import { monthNameUpper } from './format';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const bot = createBot(config, db);

  await bot.api.setMyCommands([
    { command: 'balance', description: 'Баланс за поточний місяць' },
    { command: 'balance_previous', description: 'Баланс за попередній місяць' },
    { command: 'to_previous', description: 'Додати витрату в попередній місяць' },
  ]);

  scheduleMonthlyBanner(config.timezone, async () => {
    const chatId = getMeta(db, 'group_chat_id');
    if (!chatId) {
      console.warn('No group chat id stored yet; skipping monthly banner.');
      return;
    }
    const bucket = currentBucket(config.timezone);
    try {
      const png = await renderMonthBanner(bucket.month, bucket.year);
      await bot.api.sendPhoto(Number(chatId), new InputFile(png, `${bucket.year}-${bucket.month}.png`));
    } catch (err) {
      console.error('Banner render/send failed; sending text fallback:', err);
      await bot.api.sendMessage(
        Number(chatId),
        `📅 *${monthNameUpper(bucket.month)} ${bucket.year}* 📅`,
        { parse_mode: 'Markdown' },
      );
    }
  });

  bot.catch((err) => console.error('Bot error:', err));
  console.log('Bot started.');
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
