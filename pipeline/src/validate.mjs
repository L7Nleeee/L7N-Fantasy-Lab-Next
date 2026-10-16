// Pre-publish validation. Every critical failure blocks publishing (the last known-good files stay in place).
import { addDays, diffDays, isNum } from './util.mjs';
import { CSV_COLUMNS, aggregate, lastNGames, windowGames, byRecency } from './aggregate.mjs';

export const DEFAULT_THRESHOLDS = {
  previousPlayers: 400, previousTeams: 30, currentPlayers: 150, currentTeams: 28, minGamesForCoverage: 30, registryPlayers: 450,
  staleWarnDays: 4, staleFailDays: 10, seasonStartGraceDays: 3, crossCheckMinMatchRate: 0.97,
  sampleNames: ['Tyrese Haliburton', 'Nikola Jokić', 'Shai Gilgeous-Alexander', 'Victor Wembanyama'],
};
const NUM = ['gp', 'min', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'pts', 'dd', 'td'];
const CROSS = [['gp', 'GP'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TOV'], ['fgm', 'FGM'], ['fga', 'FGA'], ['ftm', 'FTM'], ['fta', 'FTA'], ['fg3m', 'FG3M'], ['fg3a', 'FG3A']];

export function validateBundle({ today, seasonStart, seasonEnd, current, previous, recent10, recent30d, registry, dashCurrent, dashPrevious, previousManifest, requireCrossCheck = true, thresholds = {}, previousRegistry = null }) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const checks = []; const errors = []; const warnings = [];
  const check = (id, ok, detail, { critical = true } = {}) => { checks.push({ id, ok, detail }); if (!ok) (critical ? errors : warnings).push(`${id}: ${detail}`); };
  const datasets = { 'season_current.csv': current.rows, 'recent10.csv': recent10.rows, 'recent30d.csv': recent30d.rows, 'season_previous.csv': previous.rows };

  // 1. schema + numeric parsing
  for (const [name, rows] of Object.entries(datasets)) {
    let bad = 0; let first = '';
    for (const r of rows) {
      const okRow = Number.isInteger(r.player_id) && r.player_id > 0 && String(r.player || '').trim() && NUM.every((k) => isNum(r[k]) && r[k] >= 0) && CSV_COLUMNS.every((c) => c in r);
      if (!okRow) { bad++; first ||= `${r.player_id}/${r.player}`; }
    }
    check(`schema:${name}`, bad === 0, bad ? `${bad} rows fail schema/numeric checks (first: ${first})` : `${rows.length} rows ok`);
    // 2. unique player ids
    const ids = new Set(); let dup = 0; for (const r of rows) { if (ids.has(r.player_id)) dup++; ids.add(r.player_id); }
    check(`unique-ids:${name}`, dup === 0, dup ? `${dup} duplicate player_id rows (rule: ids are grouped during aggregation; duplicates in output are rejected, never silently merged)` : `${ids.size} unique ids`);
    // 5. percentages = aggregate makes / attempts
    let pbad = 0;
    for (const r of rows) for (const [m, a, p] of [['fgm', 'fga', 'fg_pct'], ['ftm', 'fta', 'ft_pct'], ['fg3m', 'fg3a', 'fg3_pct']]) {
      const exp = r[a] > 0 ? r[m] / r[a] : null; const got = r[p];
      if (exp === null ? got !== null : !(isNum(got) && Math.abs(got - exp) <= 1e-6)) pbad++;
    }
    check(`percentages:${name}`, pbad === 0, pbad ? `${pbad} percentage values differ from makes/attempts` : 'all equal total makes / total attempts');
  }

  // raw games sanity
  const future = current.games.filter((g) => g.date > addDays(today, 1)).length;
  check('no-future-games', future === 0, future ? `${future} game rows are dated after today (${today})` : 'ok');

  // 3. coverage (+ explanation of who is missing)
  const teams = (games) => new Set(games.map((g) => g.team)).size;
  check('coverage:previous', previous.rows.length >= T.previousPlayers && teams(previous.games.length ? previous.games : []) >= (previous.games.length ? T.previousTeams : 0),
    `previous season: ${previous.rows.length} players${previous.games.length ? `, ${teams(previous.games)} teams` : ' (immutable file reused)'} (need >= ${T.previousPlayers})`);
  const distinctGames = new Set(current.games.map((g) => g.gameId)).size;
  const seasonStarted = current.games.length > 0;
  if (seasonStarted && distinctGames >= T.minGamesForCoverage) {
    check('coverage:current', current.rows.length >= T.currentPlayers && teams(current.games) >= T.currentTeams, `current season: ${current.rows.length} players, ${teams(current.games)} teams over ${distinctGames} team-games (need >= ${T.currentPlayers} players, ${T.currentTeams} teams)`);
  } else if (seasonStarted) check('coverage:current', true, `only ${distinctGames} team-games so far; coverage thresholds not applied yet`);
  const rosterActive = registry.players.filter((p) => p.current);
  check('coverage:registry', registry.players.length >= T.registryPlayers, `registry has ${registry.players.length} players (need >= ${T.registryPlayers})`);
  const curIds = new Set(current.rows.map((r) => r.player_id));
  const missing = rosterActive.filter((p) => !curIds.has(p.id));
  checks.push({ id: 'coverage:explain', ok: true, detail: `${missing.length} active-roster players have no games in the current window (injured / not yet played / two-way): they stay in the registry with null stats`, sample: missing.slice(0, 25).map((p) => p.name) });

  // 4. recent10: independent recomputation
  const exp10 = aggregate(lastNGames(current.games, 10));
  const m10 = new Map(exp10.map((r) => [r.player_id, r]));
  const over = recent10.rows.filter((r) => r.gp > 10).length;
  const diff10 = recent10.rows.filter((r) => { const e = m10.get(r.player_id); return !e || e.gp !== r.gp || e.pts !== r.pts || e.min !== r.min; }).length + Math.abs(exp10.length - recent10.rows.length);
  check('recent10', over === 0 && diff10 === 0, over || diff10 ? `${over} players above 10 games; ${diff10} rows differ from each player's own latest 10 appearances` : "each player's own last 10 appearances (max 10 games)");

  // 6. recent30d: independent recomputation of the window
  const w = windowGames(current.games, recent30d.meta.dateTo, 30);
  const exp30 = aggregate(w.games); const m30 = new Map(exp30.map((r) => [r.player_id, r]));
  const diff30 = recent30d.rows.filter((r) => { const e = m30.get(r.player_id); return !e || e.gp !== r.gp || e.pts !== r.pts; }).length + Math.abs(exp30.length - recent30d.rows.length);
  check('recent30d', diff30 === 0 && recent30d.meta.dateFrom === w.dateFrom, diff30 ? `${diff30} rows differ from the ${w.dateFrom}..${w.dateTo} window` : `window ${w.dateFrom}..${w.dateTo}`);

  // 7. staleness / season-start
  const lastGame = current.meta.sourceLastGameDate;
  if (!seasonStarted) {
    const late = diffDays(today, seasonStart) > T.seasonStartGraceDays;
    check('season-start', !late, late ? `${today} is more than ${T.seasonStartGraceDays} days after the season start (${seasonStart}) but the source has no games: feed problem?` : `season not started yet (${seasonStart}); current datasets are intentionally empty`);
  } else if (today <= seasonEnd) {
    const gap = diffDays(today, lastGame);
    check('freshness', gap <= T.staleFailDays, `latest source game ${lastGame} is ${gap} day(s) old (fail > ${T.staleFailDays})`);
    if (gap > T.staleWarnDays && gap <= T.staleFailDays) warnings.push(`freshness: latest game is ${gap} days old (off-days / All-Star break are normal)`);
  }

  // 8. cross-check against the NBA season-totals endpoint (same source, different endpoint)
  const cross = (label, rows, dash) => {
    if (!dash) { check(`cross-check:${label}`, !requireCrossCheck, 'season-totals endpoint unavailable; cross-check skipped', { critical: requireCrossCheck }); return; }
    const mine = new Map(rows.map((r) => [r.player_id, r])); let match = 0; let total = 0; const bad = [];
    const dd = dash.length && 'DD2' in dash[0]; const td = dash.length && 'TD3' in dash[0];
    for (const d of dash) {
      const r = mine.get(Number(d.PLAYER_ID)); if (!r) { if (Number(d.GP) > 0) { total++; bad.push(`${d.PLAYER_NAME}: missing`); } continue; }
      total++; const diffs = CROSS.filter(([k, h]) => Number(d[h]) !== r[k]).map(([k]) => k); if (dd && Number(d.DD2) !== r.dd) diffs.push('dd'); if (td && Number(d.TD3) !== r.td) diffs.push('td');
      if (diffs.length) bad.push(`${d.PLAYER_NAME}: ${diffs.join(',')}`); else match++;
    }
    const rate = total ? match / total : 1;
    check(`cross-check:${label}`, rate >= T.crossCheckMinMatchRate, `${match}/${total} players identical to the totals endpoint (${(rate * 100).toFixed(1)}%; need ${(T.crossCheckMinMatchRate * 100).toFixed(0)}%)${bad.length ? `; first mismatches: ${bad.slice(0, 5).join(' | ')}` : ''}`);
    const names = new Map(dash.map((d) => [d.PLAYER_NAME, d])); const found = []; const wrong = [];
    for (const n of T.sampleNames) { const d = names.get(n); if (!d || Number(d.GP) === 0) continue; const r = mine.get(Number(d.PLAYER_ID)); found.push(n); if (!r || CROSS.some(([k, h]) => Number(d[h]) !== r[k])) wrong.push(n); }
    check(`sample-players:${label}`, wrong.length === 0, wrong.length ? `sample players differ: ${wrong.join(', ')}` : `${found.length} sample player(s) checked: ${found.join(', ') || 'none had games in this season'}`);
  };
  if (seasonStarted) cross('current', current.rows, dashCurrent);
  if (previous.games.length) cross('previous', previous.rows, dashPrevious);

  // 9. registry completeness + monotonic
  const regIds = new Set(registry.players.map((p) => p.id));
  const orphan = [...Object.values(datasets).flat()].filter((r) => !regIds.has(r.player_id)).length;
  check('registry:covers-datasets', orphan === 0, orphan ? `${orphan} dataset rows have ids missing from the registry` : 'every dataset id is in the registry');
  if (previousRegistry) { const lost = previousRegistry.players.filter((p) => !regIds.has(p.id)).length; check('registry:monotonic', lost === 0, lost ? `${lost} players from the previous registry disappeared` : 'no player lost'); }
  check('registry:unique', regIds.size === registry.players.length, 'registry ids are unique');

  // 10. no regression versus the last published data (same season)
  if (previousManifest?.season?.display === current.meta.season && previousManifest.files?.['season_current.csv']) {
    const prev = previousManifest.files['season_current.csv'].uniquePlayers;
    check('no-regression', current.rows.length >= prev, `current-season players ${current.rows.length} vs previously published ${prev}`);
  }
  return { ok: errors.length === 0, errors, warnings, checks };
}
void byRecency;
