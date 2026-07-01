import { describe, it, expect } from 'vitest';
import { defaultConfig, loadConfig, type ConfigIO } from '../src/config';

function memIO(initial: string | null): ConfigIO & { current: string | null } {
  const box = { current: initial };
  return {
    current: box.current,
    read: () => box.current,
    write: (t) => { box.current = t; },
  } as ConfigIO & { current: string | null };
}

const defaults = defaultConfig('/repo');

describe('loadConfig', () => {
  it('writes and returns defaults when no file exists', () => {
    const io = memIO(null);
    const cfg = loadConfig(io, defaults);
    expect(cfg).toEqual(defaults);
    expect(JSON.parse(io.read() as string)).toEqual(defaults);
  });

  it('merges missing keys from defaults over an existing partial file', () => {
    const io = memIO(JSON.stringify({ repoPath: '/other' }));
    const cfg = loadConfig(io, defaults);
    expect(cfg.repoPath).toBe('/other');
    expect(cfg.nodePath).toBeNull();
    expect(cfg.autoStartServerOnLaunch).toBe(true);
    expect(cfg.openAtLogin).toBe(true);
  });

  it('preserves explicit false values from the file', () => {
    const io = memIO(JSON.stringify({ repoPath: '/r', openAtLogin: false }));
    const cfg = loadConfig(io, defaults);
    expect(cfg.openAtLogin).toBe(false);
  });
});

describe('defaultConfig', () => {
  it('uses the given repo path and safe defaults', () => {
    expect(defaultConfig('/x')).toEqual({
      repoPath: '/x',
      nodePath: null,
      autoStartServerOnLaunch: true,
      openAtLogin: true,
    });
  });
});
