// Aggregate game records into per-player sample rows. Percentages are TOTAL makes / TOTAL attempts (never an average of averages).
import { addDays } from './util.mjs';
import { ddTd } from './normalize.mjs';

export const CSV_COLUMNS = ['player_id', 'player', 'team', 'gp', 'min', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'pts', 'dd', 'td', 'fg_pct', 'ft_pct', 'fg3_pct'];
const SUM = ['min', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'pts'];
const ratio = (m, a) => (a > 0 ? Number((m / a).toFixed(6)) : null);

export const byRecency = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0);

/** @returns {object[]} one row per player id, sorted by name then id (deterministic output -> stable checksums). */
export function aggregate(games) {
  const by = new Map();
  for (const g of games) {
    let a = by.get(g.playerId);
    if (!a) { a = { player_id: g.playerId, player: g.name, team: g.team, _last: g, gp: 0, dd: 0, td: 0, ...Object.fromEntries(SUM.map((k) => [k, 0])) }; by.set(g.playerId, a); }
    a.gp++; for (const k of SUM) a[k] += g[k];
    const x = ddTd(g); a.dd += x.dd; a.td += x.td;
    if (byRecency(g, a._last) < 0) { a._last = g; a.team = g.team; a.player = g.name; }
  }
  return [...by.values()].map((a) => {
    const { _last, ...r } = a;
    return { ...r, fg_pct: ratio(r.fgm, r.fga), ft_pct: ratio(r.ftm, r.fta), fg3_pct: ratio(r.fg3m, r.fg3a) };
  }).sort((x, y) => x.player.localeCompare(y.player) || x.player_id - y.player_id);
}

/** Each player's own latest N appearances (NOT the last N calendar days of the league). */
export function lastNGames(games, n = 10) {
  const by = new Map();
  for (const g of games) { if (!by.has(g.playerId)) by.set(g.playerId, []); by.get(g.playerId).push(g); }
  const out = [];
  for (const list of by.values()) out.push(...list.sort(byRecency).slice(0, n));
  return out;
}

/** Inclusive calendar window [dateTo-29, dateTo] (30 days). */
export function windowGames(games, dateTo, days = 30) {
  if (!dateTo) return { dateFrom: null, dateTo: null, games: [] };
  const dateFrom = addDays(dateTo, -(days - 1));
  return { dateFrom, dateTo, games: games.filter((g) => g.date >= dateFrom && g.date <= dateTo) };
}

const esc = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => `${CSV_COLUMNS.join(',')}\n${rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c])).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
