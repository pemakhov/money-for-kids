import type { TelegramGateway } from './gateway';
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

function isParticipant(config: Config, senderId: number): boolean {
  return senderId === config.user1.id || senderId === config.user2.id;
}

export async function onNewMessage(
  gateway: TelegramGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;

  const text = ev.text.trim();
  if (text === '/balance') {
    const report = await reconcileBalance(gateway, config, chatId, 'current');
    await gateway.sendMessage(chatId, report);
    return;
  }
  if (text === '/balance_previous') {
    const report = await reconcileBalance(gateway, config, chatId, 'previous');
    await gateway.sendMessage(chatId, report);
    return;
  }

  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  if (c.kind === 'count') {
    await gateway.setReaction(chatId, ev.messageId, THUMBS_UP);
    if (c.source === 'to_previous') {
      await gateway.sendMessage(chatId, formatToPreviousConfirmation(c.bucket.month, c.amountCents));
    }
    return;
  }
  // Invalid /to_previous from a participant gets usage help; everything else is silent.
  if (c.kind === 'not_expense' && /^\/to_previous\b/.test(text)) {
    await gateway.sendMessage(chatId, TO_PREVIOUS_USAGE);
  }
}

export async function onEditedMessage(
  gateway: TelegramGateway,
  config: Config,
  chatId: number,
  ev: IncomingEvent,
): Promise<void> {
  if (!isParticipant(config, ev.senderId)) return;
  const c = classify({ senderId: ev.senderId, text: ev.text, dateUnix: ev.dateUnix }, config);
  await gateway.setReaction(chatId, ev.messageId, c.kind === 'count' ? THUMBS_UP : null);
}
