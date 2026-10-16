// Small pure helpers shared by engine / data / UI.

export const normalizeName = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'.\-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Missing is NOT zero: null / '' / undefined / NaN all become null.
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
export const rateVal = (v) => { const n = num(v); if (n === null) return null; return n > 1 ? n / 100 : n; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sum = (xs) => xs.reduce((s, v) => s + v, 0);
