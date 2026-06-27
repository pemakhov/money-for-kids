import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { renderMonthBanner } from '../src/banner';

describe('renderMonthBanner', () => {
  it('produces a 1200x600 PNG buffer', async () => {
    const buf = await renderMonthBanner(6, 2026);
    // PNG signature
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(600);
  });
});
