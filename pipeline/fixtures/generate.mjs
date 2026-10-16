// TEST-ONLY synthetic source generator that emits NBA-shaped result sets. NOT real data; the ids are fake (>= 900000).
//   node pipeline/fixtures/generate.mjs --out /tmp/l7n-fixture.json [--games 14] [--today-offset 0]
import { writeFile } from 'node:fs/promises';
import { TEAM_CODES } from '../../src/data/static/teams.js';
import { seasonDisplay, addDays } from '../src/util.mjs';

function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const GAMELOG_HEADERS = ['SEASON_ID', 'PLAYER_ID', 'PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'GAME_ID', 'GAME_DATE', 'MATCHUP', 'WL', 'MIN', 'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3A', 'FG3_PCT', 'FTM', 'FTA', 'FT_PCT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'PTS', 'PLUS_MINUS'];
const NAMED = [['Tyrese Haliburton', 'IND'], ['Nikola Jokić', 'DEN'], ['Shai Gilgeous-Alexander', 'OKC'], ['Victor Wembanyama', 'SAS']];

/** @param {{season?:number, currentTeamGames?:number, perTeam?:number, seed?:number}} o */
export function buildFixture({ season = 2026, currentTeamGames = 14, perTeam = 17, seed = 5 } = {}) {
  const rnd = rng(seed); const cur = seasonDisplay(season); const prev = seasonDisplay(season - 1);
  const players = []; let nextId = 900001;
  TEAM_CODES.forEach((team, ti) => {
    for (let i = 0; i < perTeam; i++) {
      const named = i === 0 ? NAMED.find((n) => n[1] === team) : null;
      players.push({ id: named ? 990001 + NAMED.indexOf(named) : nextId++, name: named ? named[0] : `Fixture Player ${String(players.length + 1).padStart(3, '0')}`, team, ti, rank: i, talent: Math.max(0.2, 1.4 - i * 0.07 + (rnd() - 0.5) * 0.2), big: rnd() > 0.6 });
    }
  });
  const signee = { id: 991000, name: 'Fixture Signee', team: 'BOS' };
  const traded = players.find((p) => p.team === 'CHI' && p.rank === 3); traded.name = 'Fixture Traded'; traded.tradedTo = 'MIA';
  const gameRows = (seasonStr, startDate, perTeamGames) => {
    const rows = []; const start = startDate;
    for (const team of TEAM_CODES) {
      const ti = TEAM_CODES.indexOf(team);
      for (let g = 0; g < perTeamGames; g++) {
        const date = addDays(start, g * 2 + (ti % 2));
        const gameId = `00${seasonStr.slice(2, 4)}${String(ti).padStart(2, '0')}${String(g).padStart(3, '0')}`;
        const roster = players.filter((p) => p.team === team || (p.tradedTo === team && g >= Math.floor(perTeamGames / 2)));
        for (const p of roster) {
          if (p.tradedTo === team && p.team !== team && !(g >= Math.floor(perTeamGames / 2))) continue;
          if (p.tradedTo && p.team === team && g >= Math.floor(perTeamGames / 2)) continue;     // traded away mid-season
          if (p.name === 'Tyrese Haliburton' && seasonStr === cur) continue;                    // injured: zero current games
          if (p.name === 'Tyrese Haliburton' && g >= 60) continue;                              // ... and missed the end of last season
          if (p.rank > 14 || rnd() < 0.08) continue;                                            // bench / DNP
          const minutes = Math.round(Math.min(38, 10 + p.talent * 18 + rnd() * 6)); const u = minutes / 30;
          const fga = Math.max(1, Math.round((5 + p.talent * 9) * u * (0.8 + rnd() * 0.4))); const fgm = Math.min(fga, Math.round(fga * (0.38 + rnd() * 0.2)));
          const fg3a = Math.min(fga, Math.round(fga * (p.big ? 0.15 : 0.4))); const fg3m = Math.min(fg3a, fgm, Math.round(fg3a * (0.28 + rnd() * 0.15)));
          const fta = Math.round(fga * 0.25 * rnd() * 2); const ftm = Math.round(fta * (0.65 + rnd() * 0.25));
          const reb = Math.round((p.big ? 8 : 3.5) * u * (0.4 + rnd() * 1.2)); const ast = Math.round((p.big ? 2.5 : 5) * u * (0.3 + rnd() * 1.4));
          const stl = Math.round(rnd() * 2.2 * u); const blk = Math.round((p.big ? 1.6 : 0.5) * rnd() * 2 * u); const tov = Math.round(rnd() * 4 * u);
          const pts = (fgm - fg3m) * 2 + fg3m * 3 + ftm;
          const row = [seasonStr, p.id, p.name, 1610612700 + ti, p.tradedTo === team ? team : (p.tradedTo && p.team === team ? team : team), team, gameId, `${date}T00:00:00`, `${team} vs. XXX`, rnd() > 0.5 ? 'W' : 'L', minutes, fgm, fga, fga ? +(fgm / fga).toFixed(3) : 0, fg3m, fg3a, fg3a ? +(fg3m / fg3a).toFixed(3) : 0, ftm, fta, fta ? +(ftm / fta).toFixed(3) : 0, 0, reb, reb, ast, stl, blk, tov, 2, pts, 0];
          rows.push(row);
        }
      }
    }
    return rows;
  };
  const prevRows = gameRows(prev, `${season - 1}-10-21`, 82);
  const curRows = gameRows(cur, `${season}-10-21`, currentTeamGames);
  const wrap = (name, headers, rowSet) => ({ resource: name, resultSets: [{ name, headers, rowSet }] });
  // Independent implementation of season totals (the "other endpoint" the validator cross-checks against)
  const dash = (rows) => {
    const by = new Map();
    for (const r of rows) {
      const [, id, name, , , , , , , , min, fgm, fga, , fg3m, fg3a, , ftm, fta, , , , reb, ast, stl, blk, tov, , pts] = r;
      const a = by.get(id) ?? { id, name, GP: 0, MIN: 0, FGM: 0, FGA: 0, FG3M: 0, FG3A: 0, FTM: 0, FTA: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TOV: 0, PTS: 0, DD2: 0, TD3: 0 };
      a.GP++; a.MIN += min; a.FGM += fgm; a.FGA += fga; a.FG3M += fg3m; a.FG3A += fg3a; a.FTM += ftm; a.FTA += fta; a.REB += reb; a.AST += ast; a.STL += stl; a.BLK += blk; a.TOV += tov; a.PTS += pts;
      const n = [pts, reb, ast, stl, blk].filter((v) => v >= 10).length; if (n >= 2) a.DD2++; if (n >= 3) a.TD3++; by.set(id, a);
    }
    const H = ['PLAYER_ID', 'PLAYER_NAME', 'GP', 'MIN', 'FGM', 'FGA', 'FG3M', 'FG3A', 'FTM', 'FTA', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PTS', 'DD2', 'TD3'];
    return [H, [...by.values()].map((a) => [a.id, a.name, a.GP, a.MIN, a.FGM, a.FGA, a.FG3M, a.FG3A, a.FTM, a.FTA, a.REB, a.AST, a.STL, a.BLK, a.TOV, a.PTS, a.DD2, a.TD3])];
  };
  const [dh, dcur] = dash(curRows); const [, dprev] = dash(prevRows);
  const rosterHeaders = ['PERSON_ID', 'DISPLAY_LAST_COMMA_FIRST', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'FROM_YEAR', 'TO_YEAR', 'PLAYERCODE', 'TEAM_ID', 'TEAM_CITY', 'TEAM_NAME', 'TEAM_ABBREVIATION'];
  const roster = [...players.filter((p) => p.rank < 15).map((p) => [p.id, p.name, p.name, 1, '2018', String(season), '', 0, '', '', p.tradedTo || p.team]), [signee.id, signee.name, signee.name, 1, String(season), String(season), '', 0, '', '', signee.team]];
  return {
    gameLog: { [cur]: wrap('LeagueGameLog', GAMELOG_HEADERS, curRows), [prev]: wrap('LeagueGameLog', GAMELOG_HEADERS, prevRows) },
    dash: { [cur]: wrap('LeagueDashPlayerStats', dh, dcur), [prev]: wrap('LeagueDashPlayerStats', dh, dprev) },
    allPlayers: wrap('CommonAllPlayers', rosterHeaders, roster),
    truth: { players, signee, season, cur, prev, curRows: curRows.length, prevRows: prevRows.length },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const get = (n, d) => (a.includes(`--${n}`) ? a[a.indexOf(`--${n}`) + 1] : d);
  const fx = buildFixture({ currentTeamGames: Number(get('games', 14)) });
  const { truth, ...rest } = fx; await writeFile(get('out', '/tmp/l7n-fixture.json'), JSON.stringify(rest));
  console.log(`fixture written: ${get('out', '/tmp/l7n-fixture.json')} (${truth.curRows} current rows, ${truth.prevRows} previous rows)`);
}
