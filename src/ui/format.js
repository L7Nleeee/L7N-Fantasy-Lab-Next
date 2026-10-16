import { isNum } from '../engine/util.js';
export const fmt1 = (v) => (isNum(v) ? v.toFixed(1) : '—');
export const fmt2 = (v) => (isNum(v) ? v.toFixed(2) : '—');
export const pct = (v) => (isNum(v) ? (v * 100).toFixed(1) + '%' : '—');
export const int = (v) => (isNum(v) ? String(Math.round(v)) : '—');
export const signed = (v, d = 1) => (isNum(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) : '—');
export function fmtStat(kind, key, v) {
  if (!isNum(v)) return '—';
  if (kind === 'pct') return pct(v);
  if (kind === 'ratio') return fmt2(v);
  if (kind === 'total') return int(v);
  return fmt1(v);
}
export const fmtWeekly = (k, v) => (['FG', 'FT', 'P3'].includes(k) ? pct(v) : k === 'AT' ? fmt2(v) : fmt1(v));
