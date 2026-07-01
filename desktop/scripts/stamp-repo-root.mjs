import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');
mkdirSync('dist', { recursive: true });
writeFileSync(join('dist', 'repo-root.json'), JSON.stringify({ repoRoot }, null, 2));
console.log(`stamped repo-root.json -> ${repoRoot}`);
