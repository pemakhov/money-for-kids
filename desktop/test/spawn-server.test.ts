import { describe, it, expect } from 'vitest';
import { buildServerCommand } from '../src/spawn-server.js';

describe('buildServerCommand', () => {
  it('invokes tsx CLI by absolute node path with repo cwd', () => {
    const cmd = buildServerCommand('/repo', '/opt/homebrew/bin/node');
    expect(cmd).toEqual({
      command: '/opt/homebrew/bin/node',
      args: ['/repo/node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
      cwd: '/repo',
    });
  });

  it('joins paths without duplicate slashes', () => {
    const cmd = buildServerCommand('/repo/', '/node');
    expect(cmd.args[0]).toBe('/repo/node_modules/tsx/dist/cli.mjs');
  });
});
