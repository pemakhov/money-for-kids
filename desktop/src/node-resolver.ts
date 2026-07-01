export interface ResolveNodeInput {
  configured?: string | null;
  homedir: string;
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
}

/** Compare nvm version dir names like "v24.13.0" descending. */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function resolveNodePath(input: ResolveNodeInput): string | null {
  const candidates: string[] = [];
  if (input.configured) candidates.push(input.configured);
  candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node');

  const nvmRoot = `${input.homedir}/.nvm/versions/node`;
  const versions = input.listDir(nvmRoot)
    .filter((v) => /^v\d+\.\d+\.\d+$/.test(v))
    .sort(compareVersionsDesc);
  for (const v of versions) candidates.push(`${nvmRoot}/${v}/bin/node`);

  for (const c of candidates) {
    if (input.exists(c)) return c;
  }
  return null;
}
