import sharp from 'sharp';
import { monthNameUpper } from './format';

export async function renderMonthBanner(month: number, year: number): Promise<Buffer> {
  const title = `${monthNameUpper(month)} ${year}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
  <rect width="1200" height="600" fill="#1b2a4a"/>
  <text x="600" y="330" text-anchor="middle"
        font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="150" font-weight="bold" fill="#ffffff">${title}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
