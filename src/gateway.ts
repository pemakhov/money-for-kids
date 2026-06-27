export interface HistoryMessage {
  messageId: number;
  senderId: number;
  text: string;
  dateUnix: number;
  hasOurReaction: boolean;
}

export interface TelegramGateway {
  fetchHistory(chatId: number, sinceUnix: number): Promise<HistoryMessage[]>;
  setReaction(chatId: number, messageId: number, emoji: string | null): Promise<void>;
  sendMessage(chatId: number, text: string): Promise<void>;
  sendPhoto(chatId: number, png: Buffer, filename: string): Promise<void>;
}
