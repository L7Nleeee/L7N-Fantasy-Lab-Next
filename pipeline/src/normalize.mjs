// Raw NBA game-log rows -> validated game records. Missing/invalid numbers are reported, never turned into zeros.
import { isNum } from './util.mjs';

const COUNT_FIELDS = { min: 'MIN', fgm: 'FGM', fga: 'FGA', fg3m: 'FG3M', fg3a: 'FG3A', ftm: 'FTM', fta: 'FTA', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', tov: 'TOV', pts: 'PTS' };

/** @returns {{games:object[], invalid:{index:number,reason:string}[], duplicates:number}} */
export function normalizeGameLog(rows) {
  const games = []; const invalid = []; const seen = new Map(); let duplicates = 0;
  rows.forEach((r, index) => {
    const id = Number(r.PLAYER_ID); const date = String(r.GAME_DATE ?? '').slice(0, 10);
    if (!Number.isInteger(id) || id <= 0) return invalid.push({ index, reason: 'bad PLAYER_ID' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid.push({ index, reason: 'bad GAME_DATE' });
    if (!r.GAME_ID) return invalid.push({ index, reason: 'missing GAME_ID' });
    if (!String(r.PLAYER_NAME ?? '').trim()) return invalid.push({ index, reason: 'missing PLAYER_NAME' });
    const g = { playerId: id, name: String(r.PLAYER_NAME).trim(), team: String(r.TEAM_ABBREVIATION ?? '').trim(), gameId: String(r.GAME_ID), date };
    for (const [k, h] of Object.entries(COUNT_FIELDS)) {
      const v = r[h];
      if (v === null || v === undefined || v === '' || !isNum(Number(v)) || Number(v) < 0) return invalid.push({ index, reason: `bad ${h}` });
      g[k] = Number(v);
    }
    if (g.fgm > g.fga || g.fg3m > g.fg3a || g.ftm > g.fta || g.fg3m > g.fgm) return invalid.push({ index, reason: 'makes exceed attempts' });
    const key = `${id}|${g.gameId}`;
    if (seen.has(key)) { const prev = seen.get(key); if (JSON.stringify(prev) !== JSON.stringify(g)) invalid.push({ index, reason: 'conflicting duplicate (player, game)' }); else duplicates++; return; }
    seen.set(key, g); games.push(g);
  });
  return { games, invalid, duplicates };
}

/** Standard definitions: double-double = 2+ of (PTS, REB, AST, STL, BLK) >= 10; triple-double = 3+. */
export function ddTd(g) { const c = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length; return { dd: c >= 2 ? 1 : 0, td: c >= 3 ? 1 : 0 }; }

export const latestDate = (games) => games.reduce((m, g) => (g.date > m ? g.date : m), '');
