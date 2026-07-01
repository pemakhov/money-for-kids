import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { SpawnFn, ChildHandle } from './server-controller.js';
import { createServerLog } from './logger.js';

export function buildServerCommand(
  repoPath: string,
  nodePath: string,
): { command: string; args: string[]; cwd: string } {
  return {
    command: nodePath,
    args: [join(repoPath, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'],
    cwd: repoPath,
  };
}

export function createSpawn(repoPath: string, nodePath: string, logPath: string): SpawnFn {
  return () => {
    const { command, args, cwd } = buildServerCommand(repoPath, nodePath);
    const log = createServerLog(logPath);
    const child = spawn(command, args, { cwd, env: { ...process.env } });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    let ended = false;
    const endLog = () => { if (!ended) { ended = true; log.end(); } };
    child.on('exit', endLog);
    child.on('error', (err) => { log.write(`spawn error: ${err.message}\n`); endLog(); });
    return child as unknown as ChildHandle;
  };
}
