import { describe, it, expect } from 'vitest';
import { Api } from 'telegram';
import { botReactedThumbsUp } from '../src/telegram-gramjs';

const BOT_ID = 8972200079;

function reactionsWith(peerUserId: number, emoticon: string): Api.MessageReactions {
  return new Api.MessageReactions({
    results: [
      new Api.ReactionCount({ reaction: new Api.ReactionEmoji({ emoticon }), count: 1 }),
    ],
    recentReactions: [
      new Api.MessagePeerReaction({
        peerId: new Api.PeerUser({ userId: BigInt(peerUserId) as unknown as bigInt.BigInteger }),
        date: 0,
        reaction: new Api.ReactionEmoji({ emoticon }),
      }),
    ],
  });
}

describe('botReactedThumbsUp', () => {
  it('is true when the bot peer reacted with 👍', () => {
    expect(botReactedThumbsUp(reactionsWith(BOT_ID, '👍'), BOT_ID, '👍')).toBe(true);
  });

  it('is false when a different peer reacted with 👍', () => {
    expect(botReactedThumbsUp(reactionsWith(999, '👍'), BOT_ID, '👍')).toBe(false);
  });

  it('is false when the bot reacted with a different emoji', () => {
    expect(botReactedThumbsUp(reactionsWith(BOT_ID, '❤'), BOT_ID, '👍')).toBe(false);
  });

  it('is false when there are no reactions', () => {
    expect(botReactedThumbsUp(undefined, BOT_ID, '👍')).toBe(false);
  });
});
