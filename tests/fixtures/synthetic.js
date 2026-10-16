// TEST-ONLY synthetic league generator. These are NOT real NBA statistics — never ship or present them as real.
// Deterministic (seeded) so unit tests and E2E runs are reproducible.
import { YAHOO_RANKINGS } from '../../src/data/static/yahoo.js';
import { TEAM_CODES } from '../../src/data/static/teams.js';

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Per-game "truth" rows (before conversion to season totals). */
export function syntheticPlayers({ n = 520, seed = 7 } = {}) {
  const rnd = mulberry32(seed); const out = [];
  for (let i = 0; i < n; i++) {
    const name = i < YAHOO_RANKINGS.length ? YAHOO_RANKINGS[i].name : `Synthetic Player ${String(i + 1).padStart(3, '0')}`;
    const talent = Math.max(0.1, 1.5 - i / 160 + (rnd() - 0.5) * 0.4);
    const role = rnd(); // <.34 guard, <.67 wing, else big
    const gp = 20 + Math.floor(rnd() * 62);
    const mpg = Math.min(37, 12 + talent * 14 + rnd() * 5);
    const usage = mpg / 30;
    const pts = (6 + talent * 11) * usage * (0.8 + rnd() * 0.4);
    const big = role > 0.67; const guard = role < 0.34;
    const reb = (big ? 6.5 : guard ? 2.6 : 4.2) * usage * (0.7 + talent * 0.4) * (0.8 + rnd() * 0.4);
    const ast = (guard ? 5.5 : big ? 2.2 : 3.2) * usage * (0.6 + talent * 0.5) * (0.8 + rnd() * 0.4);
    const stl = (0.7 + rnd() * 0.5) * usage; const blk = (big ? 1.3 : 0.4) * usage * (0.6 + rnd() * 0.8);
    const tov = (0.9 + ast * 0.28 + pts * 0.04) * (0.8 + rnd() * 0.4);
    const fga = pts / 2.2 * (0.9 + rnd() * 0.3); const fgPct = 0.42 + (big ? 0.07 : 0) + rnd() * 0.08;
    const p3a = guard ? fga * 0.45 : big ? fga * 0.1 : fga * 0.3; const p3Pct = 0.30 + rnd() * 0.1; const p3m = p3a * p3Pct;
    const fta = pts * 0.22 * (0.7 + rnd() * 0.6); const ftPct = 0.66 + rnd() * 0.22;
    const dd = Math.round(big ? gp * (0.1 + talent * 0.18) : guard ? gp * ast / 30 * 0.2 : gp * 0.03);
    out.push({ name, team: TEAM_CODES[Math.floor(rnd() * TEAM_CODES.length)], gp, mpg, pts, reb, ast, stl, blk, tov, fga, fgm: fga * fgPct, p3a, p3m, fta, ftm: fta * ftPct, dd, td: 0 });
  }
  return out;
}

/** Season-totals CSV text (the format the original app's baseline feed uses). */
export function syntheticCsv(opts = {}) {
  const head = 'player_id,player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts,dd,td';
  const rows = syntheticPlayers(opts).map((p, i) => {
    const t = (v) => Math.round(v * p.gp);
    return [900001 + i, p.name.includes(',') ? `"${p.name}"` : p.name, p.team, p.gp, t(p.mpg), t(p.fgm), t(p.fga), t(p.p3m), t(p.p3a), t(p.ftm), t(p.fta), t(p.reb), t(p.ast), t(p.stl), t(p.blk), t(p.tov), t(p.pts), p.dd, p.td].join(',');
  });
  return [head, ...rows].join('\n') + '\n';
}

/** Per-game CSV (small fractional numbers) to exercise the per-game detection path. */
export function syntheticPerGameCsv(opts = {}) {
  const head = 'player_id,player,team,gp,mpg,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts';
  const f = (v) => v.toFixed(2);
  return [head, ...syntheticPlayers(opts).map((p, i) => [900001 + i, p.name, p.team, p.gp, f(p.mpg), f(p.fgm), f(p.fga), f(p.p3m), f(p.p3a), f(p.ftm), f(p.fta), f(p.reb), f(p.ast), f(p.stl), f(p.blk), f(p.tov), f(p.pts)].join(','))].join('\n') + '\n';
}
