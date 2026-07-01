import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_CAP = 5_000_000;

export function rotationPlan(existingSize: number | null, capBytes: number): 'append' | 'rotate' {
  if (existingSize === null) return 'append';
  return existingSize >= capBytes ? 'rotate' : 'append';
}

export function createServerLog(logPath: string, capBytes: number = DEFAULT_CAP): NodeJS.WritableStream {
  mkdirSync(dirname(logPath), { recursive: true });
  const size = existsSync(logPath) ? statSync(logPath).size : null;
  if (rotationPlan(size, capBytes) === 'rotate') {
    renameSync(logPath, `${logPath}.1`);
  }
  return createWriteStream(logPath, { flags: 'a' });
}
