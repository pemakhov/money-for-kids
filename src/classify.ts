import { parseAmountCents } from './parser';
import { bucketFromUnix, previousBucketFromUnix } from './dates';
import type { MonthBucket } from './dates';
import type { Config, Participant } from './config';

export interface ClassifyInput {
  senderId: number;
  text: string;
  dateUnix: number;
}

export type Classification =
  | { kind: 'ignore' }
  | { kind: 'not_expense' }
  | {
      kind: 'count';
      participant: Participant;
      amountCents: number;
      bucket: MonthBucket;
      source: 'message' | 'to_previous';
      description: string;
    };

// Match /to_previous, tolerating the @botusername suffix Telegram appends to
// commands in groups. The live bot path strips it via normalizeCommand, but the
// MTProto history reader (used by reconcileBalance) reads raw text and does not,
// so classify — the single source of truth for both paths — must handle it.
const TO_PREVIOUS = /^\/to_previous(?:@[A-Za-z0-9_]+)?\b/;

function participantFor(config: Config, senderId: number): Participant | null {
  if (senderId === config.user1.id) return config.user1;
  if (senderId === config.user2.id) return config.user2;
  return null;
}

export function classify(input: ClassifyInput, config: Config): Classification {
  const participant = participantFor(config, input.senderId);
  if (!participant) return { kind: 'ignore' };

  const text = input.text.trim();

  if (TO_PREVIOUS.test(text)) {
    const remainder = text.replace(TO_PREVIOUS, '').trim();
    const amountCents = parseAmountCents(remainder);
    if (amountCents === null) return { kind: 'not_expense' };
    return {
      kind: 'count', participant, amountCents,
      bucket: previousBucketFromUnix(input.dateUnix, config.timezone),
      source: 'to_previous', description: remainder,
    };
  }

  const amountCents = parseAmountCents(text);
  if (amountCents === null) return { kind: 'not_expense' };
  return {
    kind: 'count', participant, amountCents,
    bucket: bucketFromUnix(input.dateUnix, config.timezone),
    source: 'message', description: text,
  };
}
