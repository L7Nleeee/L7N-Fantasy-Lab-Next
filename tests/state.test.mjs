import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, createMemoryBackend } from '../src/state/storage.js';
import { createRepository, MIN_REMOTE_ROWS } from '../src/data/repository.js';
import { createApp } from '../src/state/app.js';
import { normalizeProfile, parseImport, encodeShare, decodeShare, makeProfile, exportProfile, exportAll } from '../src/state/profiles.js';
import { syntheticCsv } from './fixtures/synthetic.js';
import { buildSearchIndex, searchPlayers } from '../src/engine/search.js';

const fresh = (initial = {}) => { const backend = createMemoryBackend(initial); const storage = createStorage(backend); const repo = createRepository({ storage }).init(); const app = createApp({ storage, repo }); return { backend, storage, repo, app }; };
const CSV = syntheticCsv();

test('profiles: persistence round-trip across a simulated reload', () => {
  const a = fresh(); a.repo.importCsv('last', CSV, { label: 't.csv' });
  a.app.addPlayer('Nikola Jokić'); a.app.addOpp('Luka Dončić'); a.app.setWeek(5); a.app.setWeight('TOV', 0); a.app.setGames('Nikola Jokić', 1); a.app.toggleMyRank('Cade Cunningham');
  const b = createApp({ storage: a.storage, repo: createRepository({ storage: a.storage }).init() });   // "refresh"
  assert.deepEqual(b.profile.selected, ['Nikola Jokić']); assert.deepEqual(b.profile.oppSelected, ['Luka Dončić']);
  assert.equal(b.profile.week, 5); assert.equal(b.profile.weights.TOV, 0); assert.equal(b.profile.overrides['Nikola Jokić'], 1); assert.deepEqual(b.profile.myRank, ['Cade Cunningham']);
  assert.ok(b.repo.getDataset('last').rows.length > 400);
});

test('leagues: add / copy / rename / delete / switch, data stays isolated per league', () => {
  const { app } = fresh();
  app.addPlayer('Nikola Jokić');
  assert.ok(app.addLeague('League B')); assert.equal(app.profile.name, 'League B'); assert.deepEqual(app.profile.selected, []);
  app.addPlayer('Luka Dončić');
  assert.ok(app.copyLeague('League B copy')); assert.deepEqual(app.profile.selected, ['Luka Dončić']);
  app.addPlayer('Cade Cunningham'); // only the copy changes
  const [a, b, c] = app.profiles; assert.deepEqual(a.selected, ['Nikola Jokić']); assert.deepEqual(b.selected, ['Luka Dončić']); assert.equal(c.selected.length, 2);
  assert.ok(app.renameLeague('Renamed')); assert.equal(app.profile.name, 'Renamed');
  assert.ok(app.switchLeague(a.id)); assert.deepEqual(app.profile.selected, ['Nikola Jokić']);
  assert.ok(app.deleteLeague()); assert.equal(app.profiles.length, 2); assert.ok(app.profiles.some((p) => p.id === app.activeId));
  app.deleteLeague(); assert.equal(app.deleteLeague(), false);   // the last league cannot be deleted
  assert.equal(app.addLeague('   '), false);
});

test('my draft order: reorder commits ONCE; no-op and invalid orders write nothing', () => {
  const { app, storage } = fresh();
  ['A', 'B', 'C', 'D'].forEach((n) => app.toggleMyRank(n));
  const w0 = storage.writes;
  assert.ok(app.setMyRankOrder(['C', 'A', 'B', 'D']));
  assert.equal(storage.writes - w0, 1);                                     // exactly one save for the whole drag
  assert.deepEqual(app.profile.myRank, ['C', 'A', 'B', 'D']);
  const w1 = storage.writes;
  assert.equal(app.setMyRankOrder(['C', 'A', 'B', 'D']), false);            // unchanged
  assert.equal(app.setMyRankOrder(['C', 'A', 'X', 'D']), false);            // unknown member
  assert.equal(app.setMyRankOrder(['C', 'A', 'A', 'D']), false);            // duplicate
  assert.equal(storage.writes, w1);
  app.moveMyRank(0, 3); assert.deepEqual(app.profile.myRank, ['A', 'B', 'D', 'C']);
  app.toggleMyRank('B'); assert.deepEqual(app.profile.myRank, ['A', 'D', 'C']);
});

test('what-if: add/remove limited to 4, exclusive in/out, never touches the roster', () => {
  const { app } = fresh(); app.addPlayer('A');
  ['p1', 'p2', 'p3', 'p4'].forEach((n) => assert.ok(app.toggleWhatIn(n).ok));
  assert.equal(app.toggleWhatIn('p5').ok, false);
  assert.deepEqual(app.profile.selected, ['A']);
  assert.ok(app.toggleWhatOut('A').ok); assert.deepEqual(app.profile.selected, ['A']);
  app.toggleWhatIn('p1'); assert.equal(app.profile.whatIn.length, 3);
  app.clearWhatIf(); assert.deepEqual([app.profile.whatIn, app.profile.whatOut], [[], []]);
});

test('roster: a player cannot be on both sides; unknown names are kept (never silently pruned)', () => {
  const { app } = fresh(); app.addPlayer('Ghost Player Not In Data');
  assert.deepEqual(app.profile.selected, ['Ghost Player Not In Data']);
  app.addOpp('Ghost Player Not In Data'); assert.deepEqual(app.profile.selected, []); assert.deepEqual(app.profile.oppSelected, ['Ghost Player Not In Data']);
  app.addPlayer('Ghost Player Not In Data'); assert.deepEqual(app.profile.oppSelected, []);
});

test('migration: V4.0.21 profiles are COPIED, originals untouched, backup written, refMode rule applied', () => {
  const legacy = [{ id: 'L1', name: 'Old League', schemaVersion: 2, refMode: 'league', selected: ['Nikola Jokić'], oppSelected: ['Luka Dončić'], weights: { PTS: 2, TD: 5 }, week: 3, dataBasis: 'last', minGP: 30, tab: 'weekly', mystery: 42 },
    { id: 'L2', name: 'Older', refMode: 'league', selected: [] }];
  const raw = JSON.stringify(legacy);
  const { app, backend, storage } = fresh({ l7n_h2h_leagues_v1: raw, l7n_h2h_active_league_v1: 'L1' });
  assert.equal(app.profiles.length, 2); assert.equal(app.profile.id, 'L1');
  assert.equal(app.profiles[0].refMode, 'league');           // schema 2 keeps league pool
  assert.equal(app.profiles[1].refMode, 'top200');           // pre-v2 reset to top200 (original rule)
  assert.equal(app.profile.minGP, 30); assert.equal(app.profile.weights.PTS, 2);
  assert.equal(app.profile.extra.mystery, 42); assert.equal(app.profile.extra.tab, undefined);
  assert.equal(backend.getItem('l7n_h2h_leagues_v1'), raw);   // original key byte-identical
  assert.ok(storage.getJSON('backup.legacy-v4-profiles')); assert.equal(app.boot.migrated.includes('V4.0.21'), true);
  assert.ok(!backend.getItem('l7nlab.v1.profiles').includes('"tab"'));
});

test('migration: legacy single-league keys (fb_*) and legacy datasets are imported read-only', () => {
  const recs = JSON.parse(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, team: 'DEN', gp: 50, minutes: 1500, pts: 10 + i, pm3: 1, reb: 4, ast: 3, stl: 1, blk: .5, tov: 2, fg: .45, fga: 9, ft: .8, fta: 3, ftm: 2.4, p3: .35, p3a: 3, at: 1.5 }))));
  const initial = { fb_final_team: JSON.stringify(['P1', 'P2']), fb_opp_team: '["P3"]', fb_weights: '{"AST":0}', fb_week: '4', fb_custom_dataset_last: JSON.stringify(recs), fb_dataset_source_last: 'remote' };
  const { app, repo, backend } = fresh(initial);
  assert.deepEqual(app.profile.selected, ['P1', 'P2']); assert.equal(app.profile.week, 4); assert.equal(app.profile.weights.AST, 0);
  assert.equal(repo.getDataset('last').rows.length, 30); assert.equal(repo.getDataset('last').meta.legacy, true);
  for (const k of Object.keys(initial)) assert.equal(backend.getItem(k), initial[k]);
});

test('config import/export: round-trip, V4 payloads, bad files, unknown settings preserved', () => {
  const p = normalizeProfile({ ...makeProfile('X'), selected: ['A'], extra: { future: true } });
  const out = parseImport(JSON.stringify(exportProfile(p))); assert.equal(out.profiles[0].name, 'X'); assert.equal(out.profiles[0].extra.future, true); assert.notEqual(out.profiles[0].id, p.id);
  assert.equal(parseImport(JSON.stringify(exportAll([p, p], p.id))).profiles.length, 2);
  const v4 = parseImport({ version: 4, leagueName: 'From V4', team: ['A', 'B'], opp: ['C'], weights: { PTS: 3 }, week: 2 }); assert.equal(v4.profiles[0].selected.length, 2); assert.equal(v4.profiles[0].weights.PTS, 3);
  assert.ok(parseImport('not json').error); assert.ok(parseImport({ hello: 1 }).error); assert.ok(parseImport(null).error);
  const { app } = fresh(); const n = app.profiles.length; assert.equal(app.importConfig('{bad').ok, false); assert.equal(app.profiles.length, n);
  assert.equal(app.importConfig(JSON.stringify(exportProfile(p))).ok, true); assert.equal(app.profiles.length, n + 1);
});

test('share link: encode/decode with unicode, rejects garbage', () => {
  const p = normalizeProfile({ ...makeProfile('德文·聯盟'), selected: ['Nikola Jokić', 'Luka Dončić'], week: 7 });
  const q = decodeShare('#share=' + encodeShare(p)); assert.deepEqual(q.selected, p.selected); assert.equal(q.week, 7); assert.match(q.name, /德文·聯盟/);
  assert.equal(decodeShare('#share=%%%'), null); assert.equal(decodeShare('#/draft'), null);
});

test('repository: sync failure / timeout / short file keep the previous good data (atomic)', async () => {
  const { repo } = fresh(); assert.ok(repo.importCsv('last', CSV).ok); const before = repo.getDataset('last').rows.length;
  const boom = await repo.syncRemote('last', { force: true, fetchImpl: async () => { throw new Error('offline'); } }); assert.equal(boom.ok, false);
  const http = await repo.syncRemote('last', { force: true, fetchImpl: async () => ({ ok: false, status: 500 }) }); assert.equal(http.ok, false);
  const short = await repo.syncRemote('last', { force: true, fetchImpl: async () => ({ ok: true, text: async () => 'player,team,gp,pts\nA,DEN,10,100\n' }) }); assert.equal(short.ok, false);
  const hang = await repo.syncRemote('last', { force: true, timeoutMs: 20, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) }); assert.equal(hang.ok, false); assert.match(repo.sync.message, /逾時/);
  assert.equal(repo.getDataset('last').rows.length, before);
  const ok = await repo.syncRemote('last', { force: true, fetchImpl: async () => ({ ok: true, text: async () => CSV }) }); assert.equal(ok.ok, true); assert.ok(ok.count >= MIN_REMOTE_ROWS);
});

test('repository: a manual import is not overwritten by a background sync (unless forced)', async () => {
  const { repo } = fresh(); repo.importCsv('last', CSV, { label: 'mine.csv' });
  let called = 0; const r = await repo.syncRemote('last', { fetchImpl: async () => { called++; return { ok: true, text: async () => CSV }; } });
  assert.equal(r.skipped, true); assert.equal(called, 0); assert.equal(repo.getDataset('last').meta.source, 'import');
});

test('repository: storage quota failure keeps old data and reports the error', () => {
  const backend = createMemoryBackend(); let limit = Infinity; const orig = backend.setItem; backend.setItem = (k, v) => { if (String(v).length > limit) throw new Error('QuotaExceededError'); orig(k, v); };
  const storage = createStorage(backend); const repo = createRepository({ storage }).init();
  assert.ok(repo.importCsv('last', CSV).ok); const n = repo.getDataset('last').rows.length;
  limit = 1000; const r = repo.importCsv('last', syntheticCsv({ n: 450, seed: 9 })); assert.equal(r.ok, false); assert.match(r.error, /儲存空間/);
  assert.equal(repo.getDataset('last').rows.length, n); assert.equal(storage.getJSON('datasets.last', null) === null, false);
});

test('repository: three bases are independent and each survives a reload; current never overwrites last', () => {
  const { repo, storage } = fresh(); repo.importCsv('last', CSV); repo.importCsv('current', syntheticCsv({ n: 150, seed: 2 })); repo.importCsv('recent10', syntheticCsv({ n: 100, seed: 3 }));
  const again = createRepository({ storage }).init();
  assert.deepEqual(['last', 'current', 'recent10'].map((b) => again.getDataset(b).rows.length), [520, 150, 100]);
  assert.equal(again.getDataset('last').meta.season, '2025-26'); assert.equal(again.getDataset('current').meta.season, '2026-27');
  again.clearDataset('current'); assert.equal(again.getDataset('last').rows.length, 520);
});

test('app: unusable stored data does not crash; corrupt profiles fall back to a fresh league', () => {
  const { app } = fresh({ 'l7nlab.v1.profiles': '{not json', 'l7nlab.v1.active': '"zzz"' });
  assert.equal(app.profiles.length, 1); assert.ok(app.profile.id);
  const w = fresh({ 'l7nlab.v1.profiles': JSON.stringify([{ name: 5, selected: 'oops', weights: { PTS: 'NaN' }, week: 'x', teamOverrides: { A: 'ZZZ' } }]) });
  assert.deepEqual(w.app.profile.selected, []); assert.equal(w.app.profile.weights.PTS, 1); assert.equal(w.app.profile.week, 0); assert.deepEqual(w.app.profile.teamOverrides, {});
});

test('app: save failure is surfaced, not swallowed', () => {
  const backend = createMemoryBackend(); const storage = createStorage(backend); const repo = createRepository({ storage }).init(); const app = createApp({ storage, repo });
  backend.setItem = () => { throw new Error('QuotaExceededError'); };
  app.addPlayer('A'); assert.ok(app.boot.notes.some((n) => n.level === 'error' && /儲存/.test(n.text)));
  assert.deepEqual(app.profile.selected, ['A']);   // in-memory state still works
});

test('search: diacritics, nicknames, team code, Yahoo rank, no result for empty query', () => {
  const { repo } = fresh(); repo.importCsv('last', CSV); const idx = buildSearchIndex(repo.universe('last').players);
  assert.equal(searchPlayers(idx, '')[0], undefined); assert.equal(searchPlayers(idx, '   ').length, 0);
  assert.equal(searchPlayers(idx, 'jokic')[0].name, 'Nikola Jokić'); assert.equal(searchPlayers(idx, 'doncic')[0].name, 'Luka Dončić');
  assert.equal(searchPlayers(idx, 'wemby')[0].name, 'Victor Wembanyama'); assert.equal(searchPlayers(idx, '3')[0].yahooRank, 3);
  assert.equal(searchPlayers(idx, 'zzzzqqq').length, 0);
});
