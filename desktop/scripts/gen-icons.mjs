import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(assets, { recursive: true });

const SIZE = 512;
const DOT = 150;
const COLORS = { running: '#28c840', starting: '#f5b800', stopped: '#8e8e93', crashed: '#ff3b30' };

function baseSvg() {
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <rect x="24" y="24" width="464" height="464" rx="96" fill="#1f6feb"/>
       <text x="50%" y="54%" font-family="Helvetica" font-size="230" fill="white"
             text-anchor="middle" dominant-baseline="middle" font-weight="bold">₴</text>
     </svg>`,
  );
}

function dotSvg(color) {
  return Buffer.from(
    `<svg width="${DOT}" height="${DOT}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${DOT / 2}" cy="${DOT / 2}" r="${DOT / 2 - 10}" fill="${color}"
               stroke="white" stroke-width="16"/>
     </svg>`,
  );
}

const base = await sharp(baseSvg()).png().toBuffer();
await sharp(base).toFile(join(assets, 'icon.png'));

for (const [state, color] of Object.entries(COLORS)) {
  await sharp(base)
    .composite([{ input: await sharp(dotSvg(color)).png().toBuffer(), top: SIZE - DOT - 12, left: SIZE - DOT - 12 }])
    .toFile(join(assets, `icon-${state}.png`));
  console.log(`wrote icon-${state}.png`);
}
