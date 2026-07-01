import { describe, it, expect } from 'vitest';
import { rotationPlan } from '../src/logger';

describe('rotationPlan', () => {
  it('appends when the file does not exist', () => {
    expect(rotationPlan(null, 1000)).toBe('append');
  });
  it('appends when the file is below the cap', () => {
    expect(rotationPlan(999, 1000)).toBe('append');
  });
  it('rotates when the file is at or over the cap', () => {
    expect(rotationPlan(1000, 1000)).toBe('rotate');
    expect(rotationPlan(5000, 1000)).toBe('rotate');
  });
});
