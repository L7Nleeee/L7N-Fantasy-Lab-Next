// PARITY: runs the ORIGINAL V4.0.21 engine functions (copied verbatim out of its index.html into a VM) and the new engine on the
// same player universe, then compares every number. Skipped when the original file is not present.
//   L7N_ORIGINAL_HTML=/path/to/original/index.html node --test tests/parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordsFromCsv } from '../src/data/csv.js';
import { syntheticCsv } from './fixtures/synthetic.js';
import { buildUniverse } from '../src/data/universe.js';
import { buildModel, baseFit, teamFit, fitIndex } from '../src/engine/model.js';
import { teamTotals, compareCategory, projectedGames } from '../src/engine/weekly.js';
import { DEFAULT_WEIGHTS, CATS, CAT_KEYS } from '../src/engine/schema.js';
import { SCHEDULE } from '../src/data/static/schedule.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.L7N_ORIGINAL_HTML, path.join(here, '../../original/index.html')].filter(Boolean);
const origPath = candidates.find((p) => fs.existsSync(p));

test('parity with original V4.0.21 engine', { skip: origPath ? false : 'original index.html not found (set L7N_ORIGINAL_HTML)' }, () => {
  const L = fs.readFileSync(origPath, 'utf8').split('\n');
  const pick = (...ns) => ns.map((n) => L[n - 1]).join('\n');
  const consts = L.slice(640, 698).join('\n') + '\n' + L.slice(700, 706).join('\n');
  const code = `${consts}\n${pick(889, 891, 892, 893, 895, 897, 898, 899, 900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 1085)}\n;this.__api={model,baseFit,fit,fitIndex,weeklyForTeam,compareCategory,refPool,refStats,projGames,CATS,SCHEDULE};`;
  const rows = recordsFromCsv(syntheticCsv({ n: 560, seed: 11 })).records;
  const U = buildUniverse({ last: { meta: { basis: 'last', season: '2025-26', period: 'full' }, rows }, current: null, recent10: null }, 'last');
  const P = U.players;
  const names = P.map((p) => p.name);
  const scenarios = [
    { label: 'defaults / top200 / minGP 20', weights: { ...DEFAULT_WEIGHTS }, refMode: 'top200', minGP: 20, week: 0, sel: names.slice(0, 5), opp: names.slice(10, 15), overrides: {}, teamOverrides: {} },
    { label: 'league pool / minGP 40 / TOV punted / DD x2', weights: { ...DEFAULT_WEIGHTS, TOV: 0, DD: 2, BLK: 0.5 }, refMode: 'league', minGP: 40, week: 8, sel: names.slice(20, 28), opp: names.slice(30, 36), overrides: {}, teamOverrides: {} },
    { label: 'overrides + team overrides + week 17', weights: { ...DEFAULT_WEIGHTS, 'FT%': 0, FTM: 3 }, refMode: 'top200', minGP: 30, week: 17, sel: names.slice(40, 46), opp: names.slice(50, 56), overrides: { [names[40]]: 1, [names[41]]: 5 }, teamOverrides: { [names[42]]: 'LAL', [names[50]]: 'BOS' } },
  ];
  const report = [];
  for (const sc of scenarios) {
    const players = P.map((p) => ({ ...p }));
    const state = { weights: sc.weights, refMode: sc.refMode, minGP: sc.minGP, selected: new Set(sc.sel), oppSelected: new Set(sc.opp), dataBasis: 'last', week: sc.week, overrides: sc.overrides, teamOverrides: sc.teamOverrides };
    const ctx = { players, state, datasets: { last: players }, document: { getElementById: (id) => ({ value: id === 'minGP' ? String(sc.minGP) : sc.refMode }) }, console, Math, Number, Object, Array, Set, Map, String, JSON, Date, structuredClone };
    vm.createContext(ctx); vm.runInContext(code, ctx);
    const O = ctx.__api; const om = O.model();
    const nm = buildModel(P, { weights: sc.weights, minGP: sc.minGP, refMode: sc.refMode, selected: sc.sel });
    // 1. reference pool
    assert.deepEqual(nm.pool.map((p) => p.name).sort(), om.pool.map((p) => p.name).sort(), `${sc.label}: pool`);
    // 2. pool stats + per-category moments
    for (const k of Object.keys(om.r)) assert.ok(Math.abs((nm.r[k] ?? 0) - (om.r[k] ?? 0)) < 1e-9, `${sc.label}: refStats.${k}`);
    for (const k of Object.keys(om.stats)) { assert.ok(Math.abs(nm.stats[k].mean - om.stats[k].mean) < 1e-9 && Math.abs(nm.stats[k].sd - om.stats[k].sd) < 1e-9, `${sc.label}: moments ${k}`); }
    assert.deepEqual(Object.keys(nm.stats), Object.keys(om.stats));
    // 3. every z-score of every player
    let zmax = 0; let zn = 0;
    for (const k of Object.keys(om.zs)) for (const p of P) { const a = om.zs[k].get(p.name); const b = nm.zs[k].get(p.name); if (a === null || b === null) { assert.equal(a, b, `${sc.label}: z null ${k} ${p.name}`); continue; } zmax = Math.max(zmax, Math.abs(a - b)); zn++; }
    assert.ok(zmax < 1e-9, `${sc.label}: z diff ${zmax}`);
    // 4. team strength
    for (const k of Object.keys(om.strength)) { assert.ok(Math.abs(om.strength[k].z - nm.strength[k].z) < 1e-9 && Math.abs(om.strength[k].index - nm.strength[k].index) < 1e-9, `${sc.label}: strength ${k}`); }
    // 5. Base Fit / Team Fit / index for every player
    let fmax = 0;
    for (const p of players) { const np = P.find((x) => x.name === p.name); fmax = Math.max(fmax, Math.abs(O.baseFit(p, om) - baseFit(np, nm)), Math.abs(O.fit(p, om) - teamFit(np, nm)), Math.abs(O.fitIndex(O.fit(p, om)) - fitIndex(teamFit(np, nm)))); }
    assert.ok(fmax < 1e-9, `${sc.label}: fit diff ${fmax}`);
    // 6. weekly totals + per-category H2H verdicts
    const wctx = { week: sc.week, overrides: sc.overrides, teamOverrides: sc.teamOverrides, schedule: SCHEDULE };
    let wmax = 0;
    const OA = O.weeklyForTeam(players.filter((p) => sc.sel.includes(p.name))); const OB = O.weeklyForTeam(players.filter((p) => sc.opp.includes(p.name)));
    const NA = teamTotals(P.filter((p) => sc.sel.includes(p.name)), wctx); const NB = teamTotals(P.filter((p) => sc.opp.includes(p.name)), wctx);
    for (const k of Object.keys(OA.raw)) { const a = OA.raw[k]; const b = NA.raw[k]; if (a === null) { assert.equal(b, null, `${sc.label}: raw ${k}`); continue; } wmax = Math.max(wmax, Math.abs(a - b)); }
    assert.ok(wmax < 1e-9, `${sc.label}: weekly diff ${wmax}`); assert.equal(OA.totalPG, NA.totalPG);
    for (const p of players) assert.equal(O.projGames(p), projectedGames(P.find((x) => x.name === p.name), wctx).games, `${sc.label}: games ${p.name}`);
    const keys = { 'FG%': 'FG', 'FT%': 'FT', FTM: 'FTM', '3P%': 'P3', PTS: 'PTS', '3PM': '3PM', REB: 'REB', AST: 'AST', STL: 'STL', BLK: 'BLK', TOV: 'TOV', DD: 'DD', 'A/T': 'AT' };
    let wins = 0;
    for (const [label, rk] of Object.entries(keys)) {
      const o = O.compareCategory(label === 'TOV' ? 'TOV' : label, OA.raw[rk], OB.raw[rk]); const n = compareCategory(rk === 'TOV' ? 'TOV' : rk, NA.raw[rk], NB.raw[rk]);
      assert.equal(o.cls, n.cls, `${sc.label}: verdict ${label}`); if (o.cls === 'win') wins++;
    }
    report.push({ scenario: sc.label, players: P.length, pool: om.pool.length, categories: Object.keys(om.zs).length, zScoresCompared: zn, maxZDiff: zmax, maxFitDiff: fmax, maxWeeklyDiff: wmax, h2hWins: wins });
  }
  fs.writeFileSync(path.join(here, '../docs/parity-report.json'), JSON.stringify({ original: path.basename(path.dirname(origPath)) + '/' + path.basename(origPath), generatedFrom: 'synthetic fixture (test-only, not real NBA data)', scenarios: report }, null, 1));
  void CATS; void CAT_KEYS;
});
