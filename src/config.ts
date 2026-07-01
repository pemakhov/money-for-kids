export interface Participant {
  id: number;
  nominative: string;
  dative: string;
}

export interface Config {
  apiId: number;
  apiHash: string;
  sessionString: string;
  botToken: string;
  groupChatId: number;
  user1: Participant;
  user2: Participant;
  timezone: string;
}

const USER1_NAME = { nominative: 'Сергій', dative: 'Сергію' } as const;
const USER2_NAME = { nominative: 'Марина', dative: 'Марині' } as const;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

function requireIntEnv(env: NodeJS.ProcessEnv, key: string): number {
  const raw = requireEnv(env, key);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || String(n) !== raw) {
    throw new Error(`Env var ${key} must be an integer, got: ${raw}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    apiId: requireIntEnv(env, 'API_ID'),
    apiHash: requireEnv(env, 'API_HASH'),
    sessionString: requireEnv(env, 'TELEGRAM_SESSION'),
    botToken: requireEnv(env, 'BOT_TOKEN'),
    groupChatId: requireIntEnv(env, 'GROUP_CHAT_ID'),
    user1: { id: requireIntEnv(env, 'USER1_ID'), ...USER1_NAME },
    user2: { id: requireIntEnv(env, 'USER2_ID'), ...USER2_NAME },
    timezone: env.TIMEZONE?.trim() || 'Europe/Kyiv',
  };
}
