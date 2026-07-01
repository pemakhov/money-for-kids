import sharp from 'sharp';
import { monthNameUpper } from './format';
import type { BotGateway } from './gateway';
import type { MonthBucket } from './dates';

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

export async function postMonthBanner(
  bot: BotGateway,
  chatId: number,
  bucket: MonthBucket,
): Promise<void> {
  try {
    const png = await renderMonthBanner(bucket.month, bucket.year);
    await bot.sendPhoto(chatId, png, `${bucket.year}-${bucket.month}.png`);
  } catch (err) {
    console.error('Banner render/send failed; sending text fallback:', err);
    try {
      await bot.sendMessage(chatId, `📅 ${monthNameUpper(bucket.month)} ${bucket.year} 📅`);
    } catch (fallbackErr) {
      console.error('Banner text fallback also failed:', fallbackErr);
    }
  }
}
