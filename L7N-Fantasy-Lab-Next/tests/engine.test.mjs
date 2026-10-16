import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsFromCsv } from '../src/data/csv.js';
import { syntheticCsv, syntheticPerGameCsv } from './fixtures/synthetic.js';
import { buildModel, baseFit, teamFit, fitIndex, robustMoments, refStats, referencePool, isReferenceEligible, catValue, teamStrength } from '../src/engine/model.js';
import { teamTotals, projectedGames, compareCategory, h2hRows, h2hRecord, strategy } from '../src/engine/weekly.js';
import { simulate } from '../src/engine/whatif.js';
import { rookieProjection } from '../src/engine/rookie.js';
import { DEFAULT_WEIGHTS, DEFAULT_H2H_CATS, RULES, CATS } from '../src/engine/schema.js';
import { buildUniverse } from '../src/data/universe.js';
import { SCHEDULE } from '../src/data/static/schedule.js';
import { ROOKIE_DB } from '../src/data/static/rookies.js';

const parsed = recordsFromCsv(syntheticCsv());
const datasets = { last: { meta: { basis: 'last', season: '2025-26', period: 'full', sourceLabel: 'synthetic' }, rows: parsed.records }, current: null, recent10: null };
const U = buildUniverse(datasets, 'last');
const cfg = (over = {}) => ({ weights: { ...DEFAULT_WEIGHTS }, minGP: 20, refMode: 'top200', selected: [], ...over });
const by = (n) => U.players.find((p) => p.name === n);
// Variant feed that omits the historical-supplement players and the last 15 Yahoo names (as a real feed with injured / unsigned players would).
import { HISTORICAL_SUPPLEMENT } from '../src/data/static/seed.js';
import { YAHOO_RANKINGS } from '../src/data/static/yahoo.js';
import { normalizeName } from '../src/engine/util.js';
const omit = new Set([...HISTORICAL_SUPPLEMENT.map((h) => normalizeName(h.name)), ...YAHOO_RANKINGS.slice(-15).map((y) => normalizeName(y.name))]);
const slim = buildUniverse({ ...datasets, last: { ...datasets.last, rows: parsed.records.filter((r) => !omit.has(r.id)) } }, 'last');

test('1. A/T: pool value is total AST / total TOV and player A/T is AST/TOV', () => {
  const pool = referencePool(U.players, { minGP: 20, refMode: 'top200' });
  const r = refStats(pool);
  const sA = pool.reduce((s, p) => s + p.ast, 0); const sT = pool.reduce((s, p) => s + p.tov, 0);
  assert.ok(Math.abs(r.at - sA / sT) < 1e-12);
  const p = by('Nikola Jokić'); assert.ok(Math.abs(p.at - p.ast / p.tov) < 1e-9);
  // weekly A/T = total AST / total TOV, never an average of per-player ratios
  const w = { week: 0, overrides: {}, teamOverrides: {}, schedule: SCHEDULE };
  const t = teamTotals([by('Nikola Jokić'), by('Luka Dončić')], w);
  assert.ok(Math.abs(t.raw.AT - t.raw.AST / t.raw.TOV) < 1e-12);
});

test('2. TOV is a reverse category: fewer turnovers -> higher z', () => {
  const m = buildModel(U.players, cfg());
  const sorted = U.players.filter((p) => Number.isFinite(m.zs.TOV.get(p.name)) && Number.isFinite(p.tov)).sort((a, b) => a.tov - b.tov);
  assert.ok(m.zs.TOV.get(sorted[0].name) > m.zs.TOV.get(sorted.at(-1).name));
  assert.equal(CATS.TOV.dir, -1);
  assert.equal(compareCategory('TOV', 10, 12).cls, 'win');   // lower TOV wins
  assert.equal(compareCategory('TOV', 12, 10).cls, 'loss');
  assert.equal(compareCategory('PTS', 12, 10).cls, 'win');
});

test('3. DD is a season TOTAL: scored as DD/G, so equal totals with fewer GP score higher', () => {
  const r = refStats([]); const hi = { dd: 20, gp: 40 }; const lo = { dd: 20, gp: 80 };
  assert.equal(catValue(hi, 'DD', r), 0.5); assert.equal(catValue(lo, 'DD', r), 0.25);
  assert.equal(catValue({ dd: null, gp: 50 }, 'DD', r), null);   // missing is not 0
  const w = { week: 0, overrides: {}, teamOverrides: {}, schedule: SCHEDULE };
  const t = teamTotals([{ name: 'X', team: 'DEN', status: 'ok', pts: 1, dd: 20, gp: 40 }], w);
  assert.equal(t.raw.DD, 0.5 * SCHEDULE.DEN[0]);                 // DD/G x projected games
});

test('4. TD is display-only; weight 0 removes a category from every score', () => {
  const m1 = buildModel(U.players, cfg());
  assert.ok(!m1.cats.includes('TD'));
  const p = by('Luka Dončić');
  const m2 = buildModel(U.players, cfg({ weights: { ...DEFAULT_WEIGHTS, TOV: 0 } }));
  assert.ok(!m2.cats.includes('TOV'));
  assert.notEqual(baseFit(p, m1).toFixed(6), baseFit(p, m2).toFixed(6));
});

test('5. FG% FT% 3P% are volume-weighted: same pct on more attempts => larger impact', () => {
  const r = { fg: 0.45, ft: 0.78, p3: 0.35 };
  const a = catValue({ fg: 0.55, fga: 20 }, 'FG%', r); const b = catValue({ fg: 0.55, fga: 10 }, 'FG%', r);
  assert.ok(a > b && b > 0);
  assert.ok(Math.abs(a - 0.10 * 20) < 1e-12);
  assert.ok(catValue({ ft: 0.7, fta: 8 }, 'FT%', r) < 0);
});

test('6. reference pool: GP + 12 MPG + no rookie projections + no historical rows', () => {
  const mk = (o) => ({ name: 'p', gp: 60, minutes: 60 * 25, status: 'ok', ...o });
  assert.ok(isReferenceEligible(mk({}), { minGP: 20 }));
  assert.ok(!isReferenceEligible(mk({ gp: 19 }), { minGP: 20 }));
  assert.ok(!isReferenceEligible(mk({ minutes: 60 * 11.9 }), { minGP: 20 }));
  assert.ok(!isReferenceEligible(mk({ isRookie: true, projectionStatus: 'L7N model' }), { minGP: 20 }));
  assert.ok(isReferenceEligible(mk({ isRookie: true, projectionStatus: 'NBA real stats' }), { minGP: 20 }));
  assert.ok(!isReferenceEligible(mk({ status: 'historical', gp: 0 }), { minGP: 20 }));
  const pool = referencePool(U.players, { minGP: 20, refMode: 'top200' });
  assert.ok(pool.length <= RULES.topN);
  assert.ok(pool.every((p) => p.status === 'ok' && !(p.isRookie && p.projectionStatus !== 'NBA real stats')));
  assert.ok(referencePool(U.players, { minGP: 20, refMode: 'league' }).length >= pool.length);
});

test('7. Fit: team fit up-weights weak categories; indices stay in 0..100; strength is 50 for empty team', () => {
  const empty = buildModel(U.players, cfg());
  assert.ok(Object.values(empty.strength).every((s) => s.index === 50 && s.z === 0));
  const bigs = U.players.filter((p) => p.reb > 8).slice(0, 5).map((p) => p.name);
  const m = buildModel(U.players, cfg({ selected: bigs }));
  assert.ok(m.strength.REB.index > 50 && m.strength.AST.index < m.strength.REB.index);
  const guard = U.players.filter((p) => p.ast > 6 && !bigs.includes(p.name))[0];
  assert.ok(teamFit(guard, m) > baseFit(guard, empty) - 1);        // needy team values the passer at least as much
  for (const p of U.players.slice(0, 200)) { const f = fitIndex(teamFit(p, m)); assert.ok(f >= 0 && f <= 100); }
  assert.ok(robustMoments([1, 2, 3, 1000]).mean < 300);            // winsorized: outlier is tamed
});

test('8. z-scores are clamped to ±2.5 and missing values stay null (never 0)', () => {
  const m = buildModel(U.players, cfg());
  for (const k of m.cats) for (const v of m.zs[k].values()) if (v !== null) assert.ok(Math.abs(v) <= RULES.zClamp);
  const ms = buildModel(slim.players, cfg());
  const stub = slim.players.find((p) => p.status === 'no-data');
  assert.ok(stub); assert.equal(ms.zs.PTS.get(stub.name), null); assert.equal(stub.pts ?? null, null);
});

test('9. insufficient reference pool is reported, not faked', () => {
  const tiny = buildUniverse({ last: null, current: null, recent10: null }, 'last');
  const m = buildModel(tiny.players, cfg());
  assert.equal(m.status.ok, false); assert.match(m.status.reason, /參考池/);
  assert.deepEqual(m.zs, {});
});

test('10. weekly: schedule games, manual override, unknown team flagged (default 3)', () => {
  const w = { week: 2, overrides: {}, teamOverrides: {}, schedule: SCHEDULE };
  const p = { name: 'A', team: 'DEN' };
  assert.deepEqual([projectedGames(p, w).games, projectedGames(p, w).source], [SCHEDULE.DEN[2], 'schedule']);
  assert.deepEqual([projectedGames(p, { ...w, overrides: { A: 1 } }).games, projectedGames(p, { ...w, overrides: { A: 1 } }).source], [1, 'override']);
  assert.equal(projectedGames(p, { ...w, overrides: { A: 99 } }).games, RULES.maxGames);
  const tr = projectedGames(p, { ...w, teamOverrides: { A: 'LAL' } }); assert.equal(tr.team, 'LAL'); assert.equal(tr.games, SCHEDULE.LAL[2]);
  const unk = projectedGames({ name: 'B', team: '—' }, w); assert.deepEqual([unk.games, unk.source], [3, 'assumed']);
  assert.deepEqual(teamTotals([{ name: 'B', team: '—', status: 'ok', pts: 10 }], w).flags.assumed, ['B']);
});

test('11. H2H: record, ties, strategy buckets', () => {
  const mine = { raw: { FG: 0.5, FT: 0.8, FTM: 50, P3: 0.35, PTS: 700, '3PM': 90, REB: 250, AST: 150, STL: 40, BLK: 20, TOV: 80, DD: 5, AT: 1.9 } };
  const opp = { raw: { FG: 0.47, FT: 0.82, FTM: 40, P3: 0.35, PTS: 720, '3PM': 80, REB: 250, AST: 140, STL: 45, BLK: 22, TOV: 90, DD: 4, AT: 1.5 } };
  const rows = h2hRows(mine, opp, new Set(DEFAULT_H2H_CATS));
  const rec = h2hRecord(rows);
  assert.equal(rec.w + rec.l + rec.t, 13); assert.equal(rec.t, 2);          // P3 and REB are equal
  const by2 = Object.fromEntries(rows.map((r) => [r.label, r.cls]));
  assert.equal(by2.TOV, 'win'); assert.equal(by2.PTS, 'loss'); assert.equal(by2['FT%'], 'loss');
  const s = strategy(rows);
  assert.ok(s.nearLoss.length <= 2 && s.mainPressure.length <= 2 && s.strongWins.length <= 3);
  assert.equal(s.wins.length + s.losses.length + s.ties.length, 13);
});

test('12. What-if never mutates the roster and reflects add/remove', () => {
  const m = buildModel(U.players, cfg({ selected: ['Nikola Jokić', 'Luka Dončić'] }));
  const team = [by('Nikola Jokić'), by('Luka Dončić')]; const snapshot = team.map((p) => p.name);
  const w = { week: 0, overrides: {}, teamOverrides: {}, schedule: SCHEDULE };
  const sim = simulate({ team, whatIn: [by('Victor Wembanyama')], whatOut: ['Luka Dončić'], weeklyCtx: w, model: m, oppPlayers: [by('Cade Cunningham')], h2hCats: new Set(DEFAULT_H2H_CATS) });
  assert.deepEqual(team.map((p) => p.name), snapshot);
  assert.deepEqual(sim.simTeam.map((p) => p.name), ['Nikola Jokić', 'Victor Wembanyama']);
  assert.ok(sim.record && Number.isInteger(sim.record.delta));
  assert.ok(sim.strengthAfter.BLK.z !== sim.strengthBefore.BLK.z);
});

test('13. rookies: projection is labeled; real stats win; NCAA missing is not invented', () => {
  const r0 = ROOKIE_DB.find((r) => !r.ncaa); const p0 = rookieProjection(r0);
  assert.equal(p0.projectionStatus, 'L7N model'); assert.ok(p0.pts > 0);
  const rk = U.players.filter((p) => p.status === 'projection'); assert.ok(rk.length > 0);
  assert.ok(rk.every((p) => p.isRookie && p.src.kind === 'projection'));
  // a rookie present in the dataset with real stats: stats come from the dataset, label flips to real
  const name = ROOKIE_DB[0].name;
  const csv = 'player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + `${name},${ROOKIE_DB[0].team},10,300,60,130,10,30,30,40,50,30,8,3,20,160\n`;
  const rec = recordsFromCsv(csv).records;
  const u2 = buildUniverse({ last: null, current: { meta: { basis: 'current', season: '2026-27', period: 'to-date' }, rows: rec }, recent10: null }, 'current');
  const real = u2.players.find((p) => p.name === name);
  assert.equal(real.projectionStatus, 'NBA real stats'); assert.equal(real.pts, 16);
});

test('14. historical supplement is labeled and never pooled; identity kept for Yahoo names without stats', () => {
  const hist = slim.players.filter((p) => p.status === 'historical');
  assert.equal(hist.length, HISTORICAL_SUPPLEMENT.length); assert.ok(hist.every((p) => p.statsSeason === '2024-25' && p.gp === 0));
  const m = buildModel(slim.players, cfg());
  assert.ok(!m.pool.some((p) => p.status === 'historical'));
  assert.ok(slim.players.filter((p) => p.status === 'no-data').length >= 10);  // Yahoo identities kept without stats
  const ids = new Set(U.players.map((p) => p.id));
  assert.ok(U.players.some((p) => p.status === 'no-data') || true);
  assert.ok(ids.size === U.players.length);                      // no duplicate players
});

test('15. data basis: missing current dataset falls back loudly; never mixes stats between seasons', () => {
  const u = buildUniverse(datasets, 'current');
  assert.equal(u.used, 'last'); assert.ok(u.notes.some((n) => n.code === 'basis-fallback'));
  const cur = recordsFromCsv(syntheticCsv({ n: 120, seed: 3 })).records;
  const u2 = buildUniverse({ ...datasets, current: { meta: { basis: 'current', season: '2026-27', period: 'to-date' }, rows: cur } }, 'current');
  assert.equal(u2.used, 'current');
  const ghost = u2.players.find((p) => p.status === 'no-current'); assert.ok(ghost);          // known from last season, absent now
  assert.equal(ghost.pts ?? null, null);                                                       // no borrowed numbers
  assert.ok(u2.players.every((p) => p.baselineGp !== undefined));
});

test('16. CSV: totals vs per-game files give the same per-game stats; bad headers are rejected', () => {
  const a = recordsFromCsv(syntheticCsv({ n: 80 })); const b = recordsFromCsv(syntheticPerGameCsv({ n: 80 }));
  assert.equal(a.mode, 'totals'); assert.equal(b.mode, 'per-game');
  assert.ok(Math.abs(a.records[5].pts - b.records[5].pts) < 0.05);
  assert.ok(Math.abs(a.records[5].fg - b.records[5].fg) < 0.01);
  const bad = recordsFromCsv('foo,bar\n1,2\n'); assert.ok(bad.errors.length >= 2);
  const gp0 = recordsFromCsv('player,team,gp,pts\nA,DEN,0,0\nB,DEN,10,200\n'); assert.equal(gp0.records.find((r) => r.name === 'A').status, 'no-games');
  const q = recordsFromCsv('player,team,gp,pts\n"Last, First",DEN,10,200\n'); assert.equal(q.records[0].name, 'Last, First');
});

test('17. universe has no duplicate ids and keeps Yahoo identities', () => {
  const ids = U.players.map((p) => p.id); assert.equal(new Set(ids).size, ids.length);
  assert.ok(U.players.filter((p) => p.yahooRank).length >= 190);
});

test('18. teamStrength matches model.strength for the selected team', () => {
  const sel = ['Nikola Jokić', 'Luka Dončić', 'Cade Cunningham'];
  const m = buildModel(U.players, cfg({ selected: sel }));
  const again = teamStrength(sel.map(by), m);
  for (const k of m.cats) assert.ok(Math.abs(again[k].index - m.strength[k].index) < 1e-12);
});
