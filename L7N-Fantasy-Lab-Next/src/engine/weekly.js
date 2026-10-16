// Weekly H2H projection — pure functions. Ported from V4.0.21 projGames()/teamRaw()/weeklyForTeam()/compareCategory().
import { RULES, H2H_ORDER, H2H_RAW_KEY } from './schema.js';
import { isNum, clamp } from './util.js';

/**
 * Projected games for one player in the selected week.
 * source: 'override' (manual), 'schedule' (team schedule), 'assumed' (team/schedule unknown -> default 3, flagged).
 */
export function projectedGames(p, w) {
  const ov = w.overrides?.[p.name];
  if (ov !== undefined && ov !== null) return { games: clamp(Number(ov) || 0, 0, RULES.maxGames), source: 'override', team: teamOf(p, w) };
  const team = teamOf(p, w);
  const g = w.schedule?.[team]?.[w.week];
  if (isNum(g)) return { games: g, source: 'schedule', team };
  return { games: RULES.defaultGames, source: 'assumed', team };
}
export const teamOf = (p, w) => w.teamOverrides?.[p.name] || p.team;

const z0 = (v) => (isNum(v) ? v : 0);

/** Totals for a set of players over the selected week. Percentages = total made / total attempts; A/T = AST / TOV. */
export function teamTotals(team, w) {
  const raw = { PTS: 0, '3PM': 0, REB: 0, AST: 0, STL: 0, BLK: 0, TOV: 0, FGM: 0, FGA: 0, FTM: 0, FTA: 0, P3M: 0, P3A: 0, DD: 0 };
  let totalPG = 0;
  const flags = { assumed: [], noStats: [], historical: [] };
  for (const p of team) {
    const { games: g, source } = projectedGames(p, w);
    totalPG += g;
    if (source === 'assumed') flags.assumed.push(p.name);
    if (p.status === 'no-games' || p.status === 'no-data' || !isNum(p.pts)) { flags.noStats.push(p.name); continue; }
    if (p.status === 'historical') flags.historical.push(p.name);
    raw.PTS += z0(p.pts) * g; raw['3PM'] += z0(p.pm3) * g; raw.REB += z0(p.reb) * g; raw.AST += z0(p.ast) * g;
    raw.STL += z0(p.stl) * g; raw.BLK += z0(p.blk) * g; raw.TOV += z0(p.tov) * g;
    raw.FGM += z0(p.fg) * z0(p.fga) * g; raw.FGA += z0(p.fga) * g;
    raw.FTM += z0(p.ft) * z0(p.fta) * g; raw.FTA += z0(p.fta) * g;
    raw.P3M += z0(p.p3) * z0(p.p3a) * g; raw.P3A += z0(p.p3a) * g;
    raw.DD += isNum(p.dd) && p.gp > 0 ? (p.dd / p.gp) * g : 0; // DD/G x projected games (an estimate)
  }
  raw.FG = raw.FGA ? raw.FGM / raw.FGA : null;
  raw.FT = raw.FTA ? raw.FTM / raw.FTA : null;
  raw.P3 = raw.P3A ? raw.P3M / raw.P3A : null;
  raw.AT = raw.TOV ? raw.AST / raw.TOV : null;
  return { raw, totalPG, flags };
}

/** Per-category result. TOV is reverse. Equal values tie; non-finite values are '—'. */
export function compareCategory(rawKey, a, b) {
  if (!isNum(a) || !isNum(b)) return { cls: 'tie', txt: '—', rel: null, close: false };
  const rel = Math.abs(a - b) / (Math.abs(b) || 1);
  const close = rel < RULES.closeRel;
  if (a === b) return { cls: 'tie', txt: '平', rel, close: true };
  const youWin = rawKey === 'TOV' ? a < b : a > b;
  return { cls: youWin ? 'win' : 'loss', txt: youWin ? '你' : '對手', rel, close };
}

/** Signed gap from MY point of view (positive = good for me; TOV flipped). */
export function categoryGap(rawKey, a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  const d = a - b;
  return rawKey === 'TOV' ? -d : d;
}

export function h2hRows(mine, opp, cats) {
  return H2H_ORDER.filter((label) => cats.has ? cats.has(label) : cats.includes(label)).map((label) => {
    const key = H2H_RAW_KEY[label];
    const a = mine.raw[key]; const b = opp.raw[key];
    return { label, key, a, b, ...compareCategory(key, a, b), gap: categoryGap(key, a, b) };
  });
}

export function h2hRecord(rows) {
  let w = 0; let l = 0; let t = 0;
  for (const r of rows) { if (r.cls === 'win') w++; else if (r.cls === 'loss') l++; else t++; }
  return { w, l, t };
}

/** Strategy buckets exactly as in V4.0.21: pressure = biggest relative deficits, flip = smallest deficits, hold = biggest leads. */
export function strategy(rows) {
  const ok = rows.filter((r) => isNum(r.a) && isNum(r.b));
  const rel = (x) => Math.abs((x.a ?? 0) - (x.b ?? 0)) / (Math.abs(x.b ?? 0) || 1);
  const wins = ok.filter((r) => r.cls === 'win');
  const losses = ok.filter((r) => r.cls === 'loss');
  const ties = ok.filter((r) => r.cls === 'tie');
  return {
    wins, losses, ties,
    nearLoss: losses.slice().sort((x, y) => rel(x) - rel(y)).slice(0, 2),
    mainPressure: losses.slice().sort((x, y) => rel(y) - rel(x)).slice(0, 2),
    strongWins: wins.slice().sort((x, y) => rel(y) - rel(x)).slice(0, 3),
  };
}
