// Shared helpers for the data pipeline (Node >= 20, no dependencies).
import { createHash } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diffDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/** NBA starting-year notation: 2026 -> "2026-27". */
export const seasonDisplay = (start) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
export const seasonDefaults = (start) => ({ seasonStart: `${start}-10-15`, seasonEnd: `${start + 1}-04-20` });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const normalizeName = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'.\-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Stable stringify so checksums / versions do not depend on key insertion order. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
