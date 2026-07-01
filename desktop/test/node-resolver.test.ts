import { describe, it, expect } from 'vitest';
import { resolveNodePath } from '../src/node-resolver';

const HOME = '/Users/me';

describe('resolveNodePath', () => {
  it('prefers the configured path when it exists', () => {
    const p = resolveNodePath({
      configured: '/custom/node',
      homedir: HOME,
      exists: (x) => x === '/custom/node',
      listDir: () => [],
    });
    expect(p).toBe('/custom/node');
  });

  it('ignores a configured path that does not exist and falls back to homebrew', () => {
    const p = resolveNodePath({
      configured: '/missing/node',
      homedir: HOME,
      exists: (x) => x === '/opt/homebrew/bin/node',
      listDir: () => [],
    });
    expect(p).toBe('/opt/homebrew/bin/node');
  });

  it('falls back to the highest nvm version when no system node exists', () => {
    const p = resolveNodePath({
      configured: null,
      homedir: HOME,
      exists: (x) => x === `${HOME}/.nvm/versions/node/v24.13.0/bin/node`,
      listDir: (dir) =>
        dir === `${HOME}/.nvm/versions/node` ? ['v18.20.0', 'v24.13.0', 'v20.11.0'] : [],
    });
    expect(p).toBe(`${HOME}/.nvm/versions/node/v24.13.0/bin/node`);
  });

  it('returns null when nothing resolves', () => {
    const p = resolveNodePath({
      configured: null,
      homedir: HOME,
      exists: () => false,
      listDir: () => [],
    });
    expect(p).toBeNull();
  });
});
