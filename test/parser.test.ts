import { describe, it, expect } from 'vitest';
import { parseAmountCents } from '../src/parser';

describe('parseAmountCents', () => {
  it('parses a plain integer at the start', () => {
    expect(parseAmountCents('4000 гривень Ігорю на місяць')).toBe(400000);
  });
  it('parses a space-separated thousands amount', () => {
    expect(parseAmountCents('4 000 грн Максу')).toBe(400000);
  });
  it('parses a dot decimal', () => {
    expect(parseAmountCents('4000.50 на книжки')).toBe(400050);
  });
  it('parses a comma decimal', () => {
    expect(parseAmountCents('300,25 цукерки')).toBe(30025);
  });
  it('returns null when not starting with a number', () => {
    expect(parseAmountCents('купив зошити 50')).toBeNull();
  });
  it('returns null for empty / whitespace', () => {
    expect(parseAmountCents('   ')).toBeNull();
  });
  it('returns null for zero and negatives', () => {
    expect(parseAmountCents('0 нічого')).toBeNull();
    expect(parseAmountCents('-5 borrow')).toBeNull();
  });
});
