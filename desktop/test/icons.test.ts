import { describe, it, expect } from 'vitest';
import { iconFileFor } from '../src/icons';

describe('iconFileFor', () => {
  it('maps each state to its asset filename', () => {
    expect(iconFileFor('running')).toBe('icon-running.png');
    expect(iconFileFor('starting')).toBe('icon-starting.png');
    expect(iconFileFor('stopped')).toBe('icon-stopped.png');
    expect(iconFileFor('crashed')).toBe('icon-crashed.png');
  });
});
