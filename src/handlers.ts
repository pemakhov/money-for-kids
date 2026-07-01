import type { HistoryGateway, BotGateway } from './gateway';
import type { Config } from './config';
import { classify } from './classify';
import { reconcileBalance, THUMBS_UP } from './reconcile';
import { formatToPreviousConfirmation } from './format';

export interface IncomingEvent {
  senderId: number;
  messageId: number;
  text: string;
  dateUnix: number;
}

const TO_PREVIOUS_USAGE =
  'Використання: /to_previous <сума> <опис>\nНаприклад: /to_previous 300 Максу на бутерброд';

const HELP =
  'Money for Kids — облік витрат на дітей.\n' +
  '\n' +
  'Щоб записати витрату, надішліть повідомлення, що починається із суми:\n' +
  '  300 Максу на бутерброд\n' +
  'Бот позначить його 👍. Редагування повідомлення оновлює позначку.\n' +
  '\n' +
  'Команди:\n' +
  '/balance — баланс за поточний місяць\n' +
  '/balance_previous — баланс за попередній місяць\n' +
  '/to_previous <сума> <опис> — витрата в попередній місяць\n' +
  '/help — ця довідка';

function isParticipant(config: Config, senderId: number): boolean {
  return senderId === config.user1.id || senderId === config.user2.id;
}

export async function onNewMessage(
  history: HistoryGateway,
  bot: BotGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;

  const text = ev.text.trim();
  if (text === '/help') {
    await bot.sendMessage(chatId, HELP);
    return;
  }
  if (text === '/balance') {
    const report = await reconcileBalance(history, bot, config, chatId, 'current');
    await bot.sendMessage(chatId, report);
    return;
  }
  if (text === '/balance_previous') {
    const report = await reconcileBalance(history, bot, config, chatId, 'previous');
    await bot.sendMessage(chatId, report);
    return;
  }

  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  if (c.kind === 'count') {
    await bot.setReaction(chatId, ev.messageId, THUMBS_UP);
    if (c.source === 'to_previous') {
      await bot.sendMessage(chatId, formatToPreviousConfirmation(c.bucket.month, c.amountCents));
    }
    return;
  }
  // Invalid /to_previous from a participant gets usage help; everything else is silent.
  if (c.kind === 'not_expense' && /^\/to_previous\b/.test(text)) {
    await bot.sendMessage(chatId, TO_PREVIOUS_USAGE);
  }
}

export async function onEditedMessage(
  bot: BotGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;
  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  await bot.setReaction(chatId, ev.messageId, c.kind === 'count' ? THUMBS_UP : null);
}
