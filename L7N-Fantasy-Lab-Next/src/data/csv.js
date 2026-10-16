// CSV parsing + normalization into player stat records. Ported from V4.0.21 fromCsv()/makePlayer(), hardened:
//  - missing cells stay null (never coerced to 0)
//  - per-game vs season-total detection is done once per FILE, not guessed per row
//  - players with GP = 0 are kept as identity records (status 'no-games') instead of being dropped
//  - dd/td columns are read when present (DD_MAP / TD_MAP are only a fallback)
import { num, rateVal, ratio, normalizeName, isNum } from '../engine/util.js';
import { DD_MAP, TD_MAP } from './static/legacy-maps.js';

const DD_NORM = Object.fromEntries(Object.entries(DD_MAP).map(([k, v]) => [normalizeName(k), v]));
const TD_NORM = Object.fromEntries(Object.entries(TD_MAP).map(([k, v]) => [normalizeName(k), v]));

/** RFC-4180-ish parser: quotes, escaped quotes, CRLF, BOM, quoted newlines. */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return { head: [], rows: [] };
  return { head: rows[0].map((h) => String(h || '').trim()), rows: rows.slice(1) };
}

const ALIASES = {
  name: ['player', 'player_name', 'name'], nbaId: ['player_id', 'nba_id', 'person_id', 'nbaid'], team: ['team', 'team_abbreviation', 'tm'],
  position: ['pos', 'position'], gp: ['gp', 'games', 'games_played'],
  fgm: ['fgm', 'field_goals_made'], fga: ['fga', 'field_goals_attempted', 'field_attempts'],
  p3m: ['fg3m', 'three_point_made', 'three_fg', 'three_fgm', 'three_point_field_goals_made', '3pm'],
  p3a: ['fg3a', 'three_point_attempted', 'three_attempts', 'three_fga', 'three_point_field_goals_attempted', '3pa'],
  ftm: ['ftm', 'ft', 'free_throws_made', 'one_point_made'], fta: ['fta', 'ft_attempts', 'free_throw_attempts', 'one_point_attempted'],
  reb: ['reb', 'total_rebounds', 'totalrb', 'total_rb', 'trb'], ast: ['ast', 'ast_total', 'assists'],
  stl: ['stl', 'steals'], blk: ['blk', 'blocks'], tov: ['tov', 'to', 'turnovers'], pts: ['pts', 'points'],
  min: ['min', 'minutes', 'minutes_played'], mpg: ['mpg', 'min_per_game'],
  fgPct: ['fg_pct', 'fg%', 'field_percent', 'field_goal_percentage'], ftPct: ['ft_pct', 'ft%', 'ft_percent', 'free_throw_percentage'],
  p3Pct: ['fg3_pct', '3p%', '3pt%', '3p_pct', 'three_percent', 'three_point_percentage'],
  dd: ['dd', 'dd2', 'double_doubles', 'doubledoubles', 'double_double'], td: ['td', 'td3', 'triple_doubles', 'tripledoubles'],
};
const hnorm = (h) => String(h).trim().toLowerCase().replace(/\s+/g, '_');

/**
 * Parse CSV text into normalized player records.
 * @returns {{records:object[], errors:string[], warnings:string[], mode:'totals'|'per-game', columns:string[], skipped:number}}
 */
/**
 * @param {string} text
 * @param {{allowBuiltinDd?:boolean}} [opts] allowBuiltinDd: only the 2025-26 full-season baseline may fall back to the built-in DD/TD totals.
 *   Window files (本季至今 / 近 10 場 / 近 30 天) must NEVER receive season totals (they would be divided by the window's GP).
 */
export function recordsFromCsv(text, { allowBuiltinDd = true } = {}) {
  const out = { records: [], errors: [], warnings: [], mode: 'totals', columns: [], skipped: 0 };
  let parsed;
  try { parsed = parseCsv(text); } catch (e) { out.errors.push('CSV 無法解析：' + e.message); return out; }
  if (!parsed.head.length) { out.errors.push('CSV 是空的或沒有表頭。'); return out; }
  const idx = new Map(parsed.head.map((h, i) => [hnorm(h), i]));
  out.columns = parsed.head;
  const col = (key) => ALIASES[key].map(hnorm).find((a) => idx.has(a));
  const get = (row, key) => { const c = col(key); return c === undefined ? undefined : row[idx.get(c)]; };
  if (!col('name')) out.errors.push('缺少球員姓名欄位（player / player_name / name）。');
  if (!col('gp')) out.errors.push('缺少出賽場次欄位（gp / games / games_played）。');
  if (!col('pts')) out.errors.push('缺少得分欄位（pts / points）。');
  if (out.errors.length) return out;

  const raws = [];
  for (const row of parsed.rows) {
    const name = String(get(row, 'name') ?? '').trim();
    if (!name) { out.skipped++; continue; }
    const r = { name };
    for (const k of Object.keys(ALIASES)) if (k !== 'name' && k !== 'team' && k !== 'position' && k !== 'nbaId') r[k] = num(get(row, k));
    const idn = num(get(row, 'nbaId')); r.nbaId = Number.isInteger(idn) && idn > 0 ? idn : null;
    r.team = String(get(row, 'team') ?? '').trim().toUpperCase() || null;
    r.position = String(get(row, 'position') ?? '').trim() || null;
    r.fgPct = rateVal(get(row, 'fgPct')); r.ftPct = rateVal(get(row, 'ftPct')); r.p3Pct = rateVal(get(row, 'p3Pct'));
    raws.push(r);
  }
  // File-level detection: per-game files carry small, usually fractional makes/attempts.
  const withGp = raws.filter((r) => isNum(r.gp) && r.gp > 0);
  const looks = withGp.filter((r) => ((isNum(r.fga) && r.fga < 40) || (isNum(r.pts) && r.pts < 60)) && (r.fgm === null || !Number.isInteger(r.fgm)));
  out.mode = withGp.length && looks.length / withGp.length > 0.6 ? 'per-game' : 'totals';
  if (out.mode === 'per-game') out.warnings.push('偵測為「每場平均」格式，DD / TD 若沒有欄位會以內建對照表補上。');
  const hasMpgCol = !!col('mpg');

  for (const r of raws) {
    const rec = out.mode === 'per-game' ? fromPerGame(r, hasMpgCol, allowBuiltinDd) : fromTotals(r, hasMpgCol, allowBuiltinDd);
    if (!rec) { out.skipped++; continue; }
    out.records.push(rec);
  }
  const noMin = out.records.filter((r) => r.status === 'ok' && r.minutes === null).length;
  if (noMin) out.warnings.push(`${noMin} 位球員沒有分鐘數，無法判斷 MPG，不會進入參考池。`);
  return out;
}

function baseRecord(r) {
  const nk = normalizeName(r.name);
  return {
    id: nk, nbaId: r.nbaId ?? null, name: r.name, baselineTeam: r.team || null, position: r.position || null,
    gp: isNum(r.gp) ? r.gp : 0, minutes: null,
    pts: null, pm3: null, reb: null, ast: null, stl: null, blk: null, tov: null,
    fg: null, fga: null, ft: null, fta: null, ftm: null, p3: null, p3a: null, at: null, dd: null, td: null,
    status: 'no-games', ddSource: null,
  };
}

function finish(rec, r, allowBuiltin) {
  rec.dd = isNum(r.dd) ? r.dd : (allowBuiltin ? (DD_NORM[rec.id] ?? null) : null);
  rec.td = isNum(r.td) ? r.td : (allowBuiltin ? (TD_NORM[rec.id] ?? null) : null);
  rec.ddSource = isNum(r.dd) ? 'csv' : (rec.dd !== null ? 'builtin-map' : null);
  return rec;
}

function fromTotals(r, hasMpgCol, allowBuiltin) {
  const rec = baseRecord(r);
  if (!isNum(r.gp) || r.gp <= 0) return finish(rec, r, allowBuiltin);          // identity only (GP = 0)
  const g = r.gp;
  if (!isNum(r.pts)) { rec.status = 'no-data'; return finish(rec, r, allowBuiltin); }
  const per = (v) => (isNum(v) ? v / g : null);
  rec.status = 'ok';
  rec.minutes = hasMpgCol && isNum(r.mpg) ? r.mpg * g : r.min;
  rec.pts = per(r.pts); rec.pm3 = per(r.p3m); rec.reb = per(r.reb); rec.ast = per(r.ast); rec.stl = per(r.stl); rec.blk = per(r.blk); rec.tov = per(r.tov);
  rec.fga = per(r.fga); rec.fta = per(r.fta); rec.p3a = per(r.p3a);
  rec.fg = r.fgPct ?? (r.fga ? (r.fgm ?? 0) / r.fga : null);
  rec.ft = r.ftPct ?? (r.fta ? (r.ftm ?? 0) / r.fta : null);
  rec.p3 = r.p3Pct ?? (r.p3a ? (r.p3m ?? 0) / r.p3a : null);
  rec.ftm = isNum(r.ftm) ? r.ftm / g : (isNum(rec.ft) && isNum(rec.fta) ? rec.ft * rec.fta : null);
  rec.at = ratio(r.ast, r.tov);
  return finish(rec, r, allowBuiltin);
}

function fromPerGame(r, hasMpgCol, allowBuiltin) {
  const rec = baseRecord(r);
  if (!isNum(r.gp) || r.gp <= 0) return finish(rec, r, allowBuiltin);
  if (!isNum(r.pts)) { rec.status = 'no-data'; return finish(rec, r, allowBuiltin); }
  rec.status = 'ok';
  const mpg = hasMpgCol ? r.mpg : r.min;                           // in a per-game file the minutes column is MPG
  rec.minutes = isNum(mpg) ? mpg * r.gp : null;
  rec.pts = r.pts; rec.pm3 = r.p3m; rec.reb = r.reb; rec.ast = r.ast; rec.stl = r.stl; rec.blk = r.blk; rec.tov = r.tov;
  rec.fga = r.fga; rec.fta = r.fta; rec.p3a = r.p3a;
  rec.fg = r.fgPct ?? (r.fga ? (r.fgm ?? 0) / r.fga : null);
  rec.ft = r.ftPct ?? (r.fta ? (r.ftm ?? 0) / r.fta : null);
  rec.p3 = r.p3Pct ?? (r.p3a ? (r.p3m ?? 0) / r.p3a : null);
  rec.ftm = isNum(r.ftm) ? r.ftm : (isNum(rec.ft) && isNum(rec.fta) ? rec.ft * rec.fta : null);
  rec.at = ratio(r.ast, r.tov);
  return finish(rec, r, allowBuiltin);
}
