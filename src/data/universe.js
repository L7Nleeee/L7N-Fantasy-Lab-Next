// Compose the analysis player universe for a data basis. Pure: (datasets, basis, registry) -> players.
//  - stats ONLY come from the selected dataset (or the explicit historical supplement / rookie model)
//  - identity is kept for everyone we know about (dataset, last season, player registry, rookies, Yahoo list), so searches never lose players
//  - historical (2024-25) numbers are labeled and never enter the reference pool; rookie projections are never NBA stats
//  - NBA player ids come from the dataset (PLAYER_ID) or, for static lists, from a UNIQUE exact-name match in the registry. Never guessed.
import { normalizeName, isNum } from '../engine/util.js';
import { rookieProjection } from '../engine/rookie.js';
import { ROOKIE_DB } from './static/rookies.js';
import { YAHOO_RANKINGS } from './static/yahoo.js';
import { CURRENT_TEAM_OVERRIDES } from './static/team-overrides.js';
import { SEED_PLAYERS, HISTORICAL_SUPPLEMENT, SEED_SEASON } from './static/seed.js';
import { DATA_BASES } from '../engine/schema.js';
import { ratio } from '../engine/util.js';

const TEAM_NORM = Object.fromEntries(Object.entries(CURRENT_TEAM_OVERRIDES).map(([k, v]) => [normalizeName(k), v]));
export const currentTeamFor = (name, fallback) => TEAM_NORM[normalizeName(name)] || fallback || '—';
export const YAHOO_BY_ID = new Map(YAHOO_RANKINGS.map((r) => [normalizeName(r.name), r.rank]));
const ROOKIE_BY_ID = new Map(ROOKIE_DB.map((r) => [normalizeName(r.name), r]));
export const yahooRankOf = (name) => YAHOO_BY_ID.get(normalizeName(name)) ?? null;

const seedRecords = () => SEED_PLAYERS.map((x) => ({
  id: normalizeName(x.name), nbaId: null, name: x.name, baselineTeam: x.team, position: null, gp: x.gp, minutes: null,
  pts: x.pts, pm3: x.pm3, reb: x.reb, ast: x.ast, stl: x.stl, blk: x.blk, tov: x.tov, fg: x.fg, fga: x.fga, ft: x.ft, fta: x.fta,
  ftm: x.ft * x.fta, p3: x.p3, p3a: x.p3a, at: ratio(x.ast, x.tov), dd: x.dd, td: x.td, status: 'ok', ddSource: 'seed',
}));

/**
 * Two DIFFERENT players (different NBA ids) with the same normalized name must never collapse into one.
 * They are renamed "Name (TEAM)" (and "Name #id" if the team is also equal). Rows without an id keep the old behaviour.
 * Deterministic: depends only on the rows themselves.
 */
export function disambiguate(rows) {
  const groups = new Map();
  for (const r of rows) { const k = normalizeName(r.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = [];
  for (const r of rows) {
    const g = groups.get(normalizeName(r.name));
    const ids = new Set(g.filter((x) => x.nbaId).map((x) => x.nbaId));
    if (!r.nbaId || ids.size < 2) { out.push(r); continue; }
    const sameTeam = g.filter((x) => x.nbaId && (x.baselineTeam || '') === (r.baselineTeam || '')).length > 1;
    const name = `${r.name} (${r.baselineTeam || '—'})${sameTeam ? ` #${r.nbaId}` : ''}`;
    out.push({ ...r, name, id: normalizeName(name), aliases: [r.name] });
  }
  return out;
}

/**
 * @param {{last:?{meta,rows},current:?{meta,rows},recent10:?{meta,rows},recent30d:?{meta,rows}}} datasets
 * @param {'last'|'current'|'recent10'|'recent30d'} basis
 * @param {?{players:object[]}} [registry] NBA player registry from the data pipeline
 */
export function buildUniverse(datasets, basis, registry = null) {
  const notes = [];
  const has = (b) => !!datasets[b]?.rows?.length;
  let used = basis;
  let rows; let meta;
  if (has(basis)) { rows = datasets[basis].rows; meta = datasets[basis].meta; }
  else if (has('last')) {
    used = 'last'; rows = datasets.last.rows; meta = datasets.last.meta;
    if (basis !== 'last') notes.push({ level: 'warn', code: 'basis-fallback', text: `尚未載入「${DATA_BASES[basis].label}」資料，目前改用「${DATA_BASES.last.label}」。缺少的資料不會被當成 0。` });
  } else {
    used = 'seed'; rows = seedRecords(); meta = { basis: 'last', season: SEED_SEASON, period: 'full', source: 'bundled-seed', sourceLabel: '內建種子資料（僅 11 位球員）', rows: rows.length, updatedAt: null };
    notes.push({ level: 'error', code: 'seed-only', text: '目前只有內建的 11 位球員種子資料，請在「資料中心」同步或匯入完整球季資料。' });
  }
  rows = disambiguate(rows);
  const lastRows = datasets.last?.rows ? disambiguate(datasets.last.rows) : [];
  const lastById = new Map(lastRows.map((r) => [r.id || normalizeName(r.name), r]));
  const map = new Map();
  const src = (kind, extra = {}) => ({ kind, basis: used, season: meta.season, period: meta.period, source: meta.sourceLabel || meta.source, updatedAt: meta.updatedAt || null, dateFrom: meta.dateFrom || null, dateTo: meta.dateTo || null, ...extra });
  for (const r of rows) {
    const id = r.id || normalizeName(r.name);
    map.set(id, { ...r, id, nbaId: r.nbaId ?? null, nbaIdSource: r.nbaId ? 'dataset' : null, src: src('dataset') });
  }
  // Identity for players known from last season but absent from the selected dataset (no stats are borrowed).
  if (used !== 'last' && used !== 'seed') {
    for (const [id, r] of lastById) {
      if (!map.has(id)) map.set(id, { id, nbaId: r.nbaId ?? null, nbaIdSource: r.nbaId ? 'dataset' : null, name: r.name, baselineTeam: r.baselineTeam || r.team || null, position: r.position || null, gp: 0, minutes: null, status: 'no-current', src: src('identity', { note: '本期間尚無統計' }) });
    }
  }
  // Rookies: real stats (from the dataset) always win over the L7N projection.
  for (const r of ROOKIE_DB) {
    const id = normalizeName(r.name);
    const meta2 = { isRookie: true, rookie: true, draftPick: r.pick, school: r.school, position: r.position, ncaa: r.ncaa || null };
    const hit = map.get(id);
    if (hit && hit.status === 'ok') {
      map.set(id, { ...hit, ...meta2, projectionStatus: 'NBA real stats', projectionConfidence: 'high', baselineTeam: hit.baselineTeam || r.team });
    } else {
      const q = rookieProjection(r);
      map.set(id, { id, nbaId: hit?.nbaId ?? null, nbaIdSource: hit?.nbaId ? 'dataset' : null, name: r.name, baselineTeam: r.team, ...meta2, ...q, status: 'projection', src: { kind: 'projection', basis: null, season: '2026-27', period: 'projection', source: 'L7N Rookie Translation v0.1（模型估算）', updatedAt: null } });
    }
  }
  // Historical supplement: last available regular-season stats for players missing from the feed. Labeled, never pooled.
  for (const h of (used === 'last' || used === 'seed' ? HISTORICAL_SUPPLEMENT : [])) {          // never inside current / recent windows: no old numbers posing as current stats
    const id = normalizeName(h.name);
    const hit = map.get(id);
    if (hit && hit.status === 'ok') continue;
    map.set(id, {
      id, nbaId: hit?.nbaId ?? null, nbaIdSource: hit?.nbaId ? 'dataset' : null, name: h.name, baselineTeam: h.currentTeam || h.team, position: h.position || null, gp: 0, minutes: 0,
      pts: h.pts, pm3: h.pm3, reb: h.reb, ast: h.ast, stl: h.stl, blk: h.blk, tov: h.tov, fg: h.fg, fga: h.fga, ft: h.ft, fta: h.fta,
      ftm: h.ftm, p3: h.p3, p3a: h.p3a, at: h.at, dd: null, td: null, status: 'historical', statsSeason: h.statsSeason,
      src: { kind: 'historical', basis: null, season: h.statsSeason, period: 'full', source: `${h.statsSeason} 歷史參考（${SEED_SEASON} GP=0）`, updatedAt: null },
    });
  }
  // Player registry: identity (and NBA id) for everyone on a roster / seen last season, regardless of games played.
  const regPlayers = registry?.players ?? [];
  if (regPlayers.length) {
    const regByName = new Map();
    for (const e of regPlayers) for (const nm of [e.name, ...(e.aliases || [])]) { const k = normalizeName(nm); if (!regByName.has(k)) regByName.set(k, new Map()); regByName.get(k).set(e.id, e); }
    const uniqueByName = (k) => { const m = regByName.get(k); return m && m.size === 1 ? [...m.values()][0] : null; };
    for (const p of map.values()) {                                    // attach ids to records that lack one (unique exact-name match only)
      if (p.nbaId) continue;
      const e = uniqueByName(p.id); if (e) { p.nbaId = e.id; p.nbaIdSource = 'registry-name'; if (!p.baselineTeam && e.team) p.baselineTeam = e.team; }
    }
    const haveIds = new Set([...map.values()].map((p) => p.nbaId).filter(Boolean));
    for (const e of regPlayers) {
      if (!(e.current || e.lastSeason) || haveIds.has(e.id)) continue;
      let id = normalizeName(e.name); let name = e.name;
      if (map.has(id)) { name = `${e.name} (${e.team || '—'})`; id = normalizeName(name); if (map.has(id)) { name = `${e.name} #${e.id}`; id = normalizeName(name); } }
      map.set(id, { id, nbaId: e.id, nbaIdSource: 'registry', name, baselineTeam: e.team || null, position: null, gp: 0, minutes: null, status: 'no-games', src: { kind: 'registry', basis: null, season: registry.season || null, period: null, source: '球員主檔（本期間沒有成績，狀態為未取得，不是 0）', updatedAt: null } });
      haveIds.add(e.id);
    }
  }
  // Yahoo list = identity entry point: unmatched names are kept (no stats) instead of vanishing.
  for (const y of YAHOO_RANKINGS) {
    const id = normalizeName(y.name);
    if (!map.has(id)) map.set(id, { id, nbaId: null, name: y.name, baselineTeam: null, position: null, gp: 0, minutes: null, status: 'no-data', src: { kind: 'identity', basis: null, season: null, period: null, source: 'Yahoo Rank 名單（尚無統計資料）', updatedAt: null } });
  }
  const players = [];
  for (const [id, p] of map) {
    const baselineGp = used === 'last' || used === 'seed' ? (p.status === 'ok' ? p.gp : 0) : (lastById.get(id)?.gp || 0);
    players.push({
      ...p, team: currentTeamFor(p.name, p.baselineTeam), baselineGp,
      yahooRank: YAHOO_BY_ID.get(id) ?? null, isRookie: !!(p.isRookie || ROOKIE_BY_ID.has(id)),
    });
  }
  return { players, used, meta, notes, counts: { total: players.length, withStats: players.filter((p) => p.status === 'ok').length, projected: players.filter((p) => p.status === 'projection').length, registryOnly: players.filter((p) => p.src?.kind === 'registry').length, withNbaId: players.filter((p) => p.nbaId).length } };
}
