// Single source of truth for Fantasy categories, directions and display columns.
// Ported from L7N V4.0.21 (CATS / DEFAULTS / DEFAULT_H2H_CATS). Do NOT change meanings here without a
// regression review: TOV is a reverse category, TD is informational only, DD is a season TOTAL.

export const CATS = Object.freeze({
  PTS:   { dir: 1,  type: 'avg',   score: true,  label: 'PTS' },
  '3PM': { dir: 1,  type: 'avg',   score: true,  label: '3PM' },
  REB:   { dir: 1,  type: 'avg',   score: true,  label: 'REB' },
  AST:   { dir: 1,  type: 'avg',   score: true,  label: 'AST' },
  STL:   { dir: 1,  type: 'avg',   score: true,  label: 'STL' },
  BLK:   { dir: 1,  type: 'avg',   score: true,  label: 'BLK' },
  'FG%': { dir: 1,  type: 'pct',   score: true,  label: 'FG%' },
  'FT%': { dir: 1,  type: 'pct',   score: true,  label: 'FT%' },
  FTM:   { dir: 1,  type: 'avg',   score: true,  label: 'FTM' },
  TOV:   { dir: -1, type: 'avg',   score: true,  label: 'TOV' },
  DD:    { dir: 1,  type: 'total', score: true,  label: 'DD' },
  TD:    { dir: 1,  type: 'total', score: false, label: 'TD' },
  'A/T': { dir: 1,  type: 'ratio', score: true,  label: 'A/T' },
  '3P%': { dir: 1,  type: 'pct3',  score: true,  label: '3P%' },
});

export const CAT_KEYS = Object.freeze(Object.keys(CATS));
export const SCORING_CATS = Object.freeze(CAT_KEYS.filter((k) => CATS[k].score));
export const DEFAULT_WEIGHTS = Object.freeze(Object.fromEntries(CAT_KEYS.map((k) => [k, CATS[k].score ? 1 : 0])));
export const DEFAULT_H2H_CATS = Object.freeze(['FG%', 'FT%', 'FTM', '3P%', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'DD', 'A/T']);

// H2H category label -> key inside weekly totals (`raw`).
export const H2H_RAW_KEY = Object.freeze({
  'FG%': 'FG', 'FT%': 'FT', FTM: 'FTM', '3P%': 'P3', PTS: 'PTS', '3PM': '3PM', REB: 'REB',
  AST: 'AST', STL: 'STL', BLK: 'BLK', TOV: 'TOV', DD: 'DD', 'A/T': 'AT',
});
export const H2H_ORDER = Object.freeze(['FG%', 'FT%', 'FTM', '3P%', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'DD', 'A/T']);

// Display columns for per-player tables (field -> category used for green/red tinting).
export const STAT_COLUMNS = Object.freeze([
  { key: 'pts', cat: 'PTS',  label: 'PTS/G',  kind: 'avg' },
  { key: 'pm3', cat: '3PM',  label: '3PM/G',  kind: 'avg' },
  { key: 'ftm', cat: 'FTM',  label: 'FTM/G',  kind: 'avg' },
  { key: 'reb', cat: 'REB',  label: 'REB/G',  kind: 'avg' },
  { key: 'ast', cat: 'AST',  label: 'AST/G',  kind: 'avg' },
  { key: 'stl', cat: 'STL',  label: 'STL/G',  kind: 'avg' },
  { key: 'blk', cat: 'BLK',  label: 'BLK/G',  kind: 'avg' },
  { key: 'fg',  cat: 'FG%',  label: 'FG%',    kind: 'pct' },
  { key: 'ft',  cat: 'FT%',  label: 'FT%',    kind: 'pct' },
  { key: 'tov', cat: 'TOV',  label: 'TOV/G',  kind: 'avg' },
  { key: 'dd',  cat: 'DD',   label: 'DD（季）', kind: 'total' },
  { key: 'td',  cat: 'TD',   label: 'TD（季）', kind: 'total' },
  { key: 'at',  cat: 'A/T',  label: 'A/T',    kind: 'ratio' },
  { key: 'p3',  cat: '3P%',  label: '3P%',    kind: 'pct' },
]);

export const DATA_BASES = Object.freeze({
  last:     { id: 'last',     label: '2025-26 完整球季', short: '上季完整', season: '2025-26', period: 'full' },
  current:  { id: 'current',  label: '2026-27 開季至今', short: '本季至今', season: '2026-27', period: 'to-date' },
  recent10: { id: 'recent10', label: '2026-27 近 10 場', short: '近 10 場', season: '2026-27', period: 'last10' },
  recent30d: { id: 'recent30d', label: '2026-27 近 30 天', short: '近 30 天', season: '2026-27', period: 'last30d' },
});
export const BASIS_IDS = Object.freeze(Object.keys(DATA_BASES));

// Calibrated constants carried over from V4.0.21. Changing any of them changes every Fit score.
export const RULES = Object.freeze({
  neutral: 50,
  zClamp: 2.5,
  winsorTail: 0.05,       // 5/95 winsorized moments
  strengthSpread: 20,     // index = 50 + 20 * tanh(z / 2.5)
  strengthTanhDiv: 2.5,
  fitSpread: 14,          // fitIndex = 50 + 14 * x
  minMpg: 12,             // reference pool: >= 12 minutes per game
  minGpFloor: 20,         // effective floor for the "min GP" setting
  maxGp: 82,
  topN: 200,              // 'top200' reference pool size
  pctBaselineGp: 20,      // FG/FT/3P pools require >= 20 baseline GP
  tintZ: 0.35,            // |z| >= 0.35 -> green / red cell
  fitStrong: 58,
  fitWeak: 47,
  strongIdx: 58,
  weakIdx: 47,
  defaultGames: 3,        // schedule fallback when a team has no schedule row (flagged in UI)
  maxGames: 5,
  minPool: 30,            // guard: below this, the reference pool is treated as unusable (no fake scores)
  closeRel: 0.03,         // UI-only "接近" tag threshold for H2H gaps (does not change win/loss)
});

export const clampMinGp = (v) => Math.max(RULES.minGpFloor, Math.min(RULES.maxGp, Number(v) || RULES.minGpFloor));
