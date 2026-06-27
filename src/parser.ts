const LEADING_NUMBER = /^\s*(\d[\d\s]*(?:[.,]\d+)?)/;

export function parseAmountCents(text: string): number | null {
  const m = LEADING_NUMBER.exec(text);
  if (!m) return null;
  const normalized = m[1].replace(/\s+/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
