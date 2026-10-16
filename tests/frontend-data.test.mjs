// Front-end data layer: NBA ids, player registry, pipeline sync, headshot addressing, window-file DD fix, duplicate names, order copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../pipeline/fixtures/generate.mjs';
import { runPipeline } from '../pipeline/src/build.mjs';
import { parseResultSet } from '../pipeline/src/nba-client.mjs';
import { sha256 } from '../pipeline/src/util.mjs';
import { recordsFromCsv } from '../src/data/csv.js';
import { createRepository, pipelineFreshness } from '../src/data/repository.js';
import { buildUniverse, disambiguate } from '../src/data/universe.js';
import { createApp } from '../src/state/app.js';
import { createStorage, createMemoryBackend } from '../src/state/storage.js';
import { nbaHeadshotUrl, isNbaId } from '../src/data/nba-image.js';
import { avatarHtml, setPhotosEnabled, markPhotoFailedId } from '../src/components/avatar.js';
import { buildSearchIndex, searchPlayers } from '../src/engine/search.js';
import { DD_MAP } from '../src/data/static/legacy-maps.js';
import { normalizeName } from '../src/engine/util.js';
import { buildModel } from '../src/engine/model.js';
import { DEFAULT_WEIGHTS } from '../src/engine/schema.js';

const FX = buildFixture();
const clone = (x) => structuredClone(x);
const clientFor = (fx) => ({ gameLog: async (s) => parseResultSet(clone(fx.gameLog[s])), dashTotals: async (s) => parseResultSet(clone(fx.dash[s])), allPlayers: async () => parseResultSet(clone(fx.allPlayers)) });
async function publishFixture(fx = FX, now = new Date('2026-11-18T06:00:00Z'), season = 2026) {
  const out = await mkdtemp(join(tmpdir(), 'l7n-pub-')); const res = await runPipeline({ season, outDir: out, now, client: clientFor(fx) });
  assert.equal(res.status, 'published', res.message); return out;
}
/** fetch() that serves a published data folder, with optional per-path overrides. */
const serve = (out, { override = {} } = {}) => async (url) => {
  const path = new URL(url).pathname.replace(/^\/data\//, '');
  if (path in override) { const o = override[path]; if (o instanceof Error) throw o; return o; }
  try { const text = await readFile(join(out, path), 'utf8'); return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }; } catch { return { ok: false, status: 404, text: async () => '', json: async () => ({}) }; }
};
const BASE = 'https://example.test/data/';
const fresh = () => { const storage = createStorage(createMemoryBackend()); const repo = createRepository({ storage }).init(); const app = createApp({ storage, repo }); return { storage, repo, app }; };

// ---------- player id + window-file fixes ----------
test('csv: PLAYER_ID is kept as nbaId (null when missing/invalid; never guessed); name-based rosters are unaffected', () => {
  const r = recordsFromCsv('player_id,player,team,gp,pts\n203999,Nikola Jokić,DEN,50,1500\n,No Id,LAL,10,100\nabc,Bad Id,LAL,10,100\n-5,Neg,LAL,10,100\n').records;
  assert.deepEqual(r.map((x) => x.nbaId), [203999, null, null, null]);
  const { app, repo } = fresh(); repo.importCsv('last', 'player_id,player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + Array.from({ length: 30 }, (_, i) => `${900000 + i},P${i},DEN,50,1500,300,600,60,150,100,130,300,200,50,30,100,${800 + i}`).join('\n'));
  app.addPlayer('P3'); assert.equal(app.rosterPlayers(app.profile.selected)[0].nbaId, 900003); assert.deepEqual(app.profile.selected, ['P3']);
});
test('REGRESSION (B1): window files never receive the built-in season DD/TD totals; only the full-season baseline may', () => {
  const star = Object.keys(DD_MAP)[0]; const csv = `player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n${star},DEN,10,330,100,200,10,30,50,60,100,50,10,5,25,300\n`;
  assert.equal(recordsFromCsv(csv, { allowBuiltinDd: false }).records[0].dd, null);
  assert.equal(recordsFromCsv(csv, { allowBuiltinDd: true }).records[0].dd, DD_MAP[star]);
  assert.equal(recordsFromCsv(csv + '', { allowBuiltinDd: false }).records[0].ddSource, null);
  const withCol = recordsFromCsv(csv.replace('pts', 'pts,dd').replace(/300\n$/, '300,3\n'), { allowBuiltinDd: false }).records[0]; assert.equal(withCol.dd, 3);
  const { repo } = fresh(); const big = 'player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + [star, ...Array.from({ length: 25 }, (_, i) => `Z${i}`)].map((n) => `${n},DEN,10,330,100,200,10,30,50,60,100,50,10,5,25,300`).join('\n');
  repo.importCsv('recent10', big); assert.equal(repo.getDataset('recent10').rows.find((r) => r.name === star).dd, null);
  repo.importCsv('last', big); assert.equal(repo.getDataset('last').rows.find((r) => r.name === star).dd, DD_MAP[star]);
});
test('REGRESSION (B2): two different players with the same name (different NBA ids) both stay in the pool', () => {
  const rows = recordsFromCsv('player_id,player,team,gp,pts\n1631114,Jalen Williams,OKC,50,1000\n9999991,Jalen Williams,CHI,40,400\n5,Solo Guy,DEN,10,100\n').records;
  const d = disambiguate(rows); assert.deepEqual(d.map((r) => r.name), ['Jalen Williams (OKC)', 'Jalen Williams (CHI)', 'Solo Guy']);
  const u = buildUniverse({ last: { meta: {}, rows }, current: null, recent10: null, recent30d: null }, 'last');
  const jw = u.players.filter((p) => p.name.startsWith('Jalen Williams') && p.nbaId); assert.equal(jw.length, 2);   // (the Yahoo-list name stays an unmatched stub: ambiguous names are never auto-assigned a rank) assert.deepEqual(jw.map((p) => p.nbaId).sort(), [1631114, 9999991]);
  assert.equal(new Set(u.players.map((p) => p.id)).size, u.players.length);
  const same = disambiguate(recordsFromCsv('player_id,player,team,gp,pts\n1,Same Name,DEN,5,5\n2,Same Name,DEN,5,5\n').records); assert.deepEqual(same.map((r) => r.name), ['Same Name (DEN) #1', 'Same Name (DEN) #2']);
  const legacy = disambiguate(recordsFromCsv('player,team,gp,pts\nSame Name,DEN,5,5\nSame Name,LAL,5,5\n').records); assert.deepEqual(legacy.map((r) => r.name), ['Same Name', 'Same Name']);   // no ids -> old behaviour
});

// ---------- headshots ----------
test('nba-image: official CDN URLs are built from verified positive integer ids only', () => {
  assert.equal(nbaHeadshotUrl(203999, 'large'), 'https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png');
  assert.equal(nbaHeadshotUrl(203999), 'https://cdn.nba.com/headshots/nba/latest/260x190/203999.png');
  for (const bad of [null, undefined, 0, -1, 1.5, '203999', NaN, 'Nikola Jokić']) { assert.equal(nbaHeadshotUrl(bad), null); assert.equal(isNbaId(bad), false); }
});
test('avatarHtml: id -> official image over initials; no id / failed id / photos off -> initials only; names are escaped', () => {
  setPhotosEnabled(true);
  const a = avatarHtml({ name: 'Nikola Jokić', team: 'DEN', nbaId: 203999 }, 'md'); assert.match(a, /<img class="av-img" src="https:\/\/cdn\.nba\.com\/headshots\/nba\/latest\/260x190\/203999\.png"/); assert.match(a, /alt="Nikola Jokić 大頭照"/); assert.match(a, /loading="lazy"/); assert.match(a, /width="36" height="36"/); assert.match(a, /tabindex="0"/); assert.match(a, />NJ</);
  const none = avatarHtml({ name: 'No Id', team: 'DEN', nbaId: null }); assert.doesNotMatch(none, /<img/); assert.doesNotMatch(none, /tabindex/); assert.match(none, /NI/);
  markPhotoFailedId(777); assert.doesNotMatch(avatarHtml({ name: 'Broken', nbaId: 777 }), /<img/);
  setPhotosEnabled(false); assert.doesNotMatch(avatarHtml({ name: 'X Y', nbaId: 5 }), /<img/); setPhotosEnabled(true);
  const xss = avatarHtml({ name: '"><script>x</script>', nbaId: 9 }); assert.doesNotMatch(xss, /<script>/);
});

// ---------- pipeline sync into the app ----------
test('pipeline sync: all datasets + registry land together with provenance; ids reach the player pool', async () => {
  const out = await publishFixture(); const { repo, app } = fresh();
  const r = await repo.syncPipeline(BASE, { fetchImpl: serve(out) }); assert.equal(r.ok, true, r.error); assert.deepEqual(r.committed.sort(), ['current', 'last', 'recent10', 'recent30d']);
  assert.equal(repo.getDataset('last').meta.source, 'pipeline'); assert.equal(repo.getDataset('last').meta.season, '2025-26'); assert.equal(repo.getDataset('recent30d').meta.dateTo, '2026-11-17'); assert.equal(repo.getDataset('recent30d').meta.dateFrom, '2026-10-19');
  assert.ok(repo.getDataset('current').rows.every((x) => x.nbaId > 0)); assert.ok(repo.registry.players.length >= 450); assert.equal(repo.pipelineMeta.season.display, '2026-27');
  assert.equal(repo.getDataset('current').rows.find((x) => x.name === 'Nikola Jokić').dd !== undefined, true);
  app.setBasis('recent10'); const u = app.universe(); assert.equal(u.used, 'recent10'); assert.ok(u.players.find((p) => p.name === 'Nikola Jokić').nbaId);
  await rm(out, { recursive: true });
});
test('pipeline sync: a high-value player with ZERO games in the window stays searchable, has no fake stats and keeps a verified id', async () => {
  const out = await publishFixture(); const { repo } = fresh(); await repo.syncPipeline(BASE, { fetchImpl: serve(out) });
  for (const basis of ['current', 'recent10', 'recent30d']) {
    const u = repo.universe(basis); const h = u.players.find((p) => p.name === 'Tyrese Haliburton');
    assert.ok(h, `${basis}: Haliburton must remain in the pool`); assert.equal(h.nbaId, 990001); assert.equal(h.pts ?? null, null); assert.ok(['no-current', 'no-games'].includes(h.status)); assert.equal(h.gp, 0);
    const idx = buildSearchIndex(u.players); assert.equal(searchPlayers(idx, 'haliburton')[0].name, 'Tyrese Haliburton');
    const m = buildModel(u.players, { weights: { ...DEFAULT_WEIGHTS }, minGP: 20, refMode: 'top200', selected: [] }); assert.ok(!m.pool.some((p) => p.name === 'Tyrese Haliburton'));   // not in the reference pool, and not zero-filled
  }
  const last = repo.universe('last').players.find((p) => p.name === 'Tyrese Haliburton'); assert.equal(last.status, 'ok'); assert.ok(last.pts > 0);   // previous season stats are real
  const signee = repo.universe('last').players.find((p) => p.name === 'Fixture Signee'); assert.ok(signee && signee.nbaId === 991000 && signee.status === 'no-games' && signee.src.kind === 'registry');
  await rm(out, { recursive: true });
});
test('registry ids attach to static lists ONLY by a unique exact-name match (never guessed)', () => {
  const registry = { season: '2026-27', players: [{ id: 111, name: 'Victor Wembanyama', aliases: [], team: 'SAS', current: true, lastSeason: true }, { id: 222, name: 'Dup Name', aliases: [], team: 'AAA', current: true, lastSeason: false }, { id: 333, name: 'Dup Name', aliases: [], team: 'BBB', current: true, lastSeason: false }] };
  const rows = recordsFromCsv('player,team,gp,pts\nVictor Wembanyama,SAS,50,1500\nDup Name,AAA,20,200\n').records;
  const u = buildUniverse({ last: { meta: {}, rows }, current: null, recent10: null, recent30d: null }, 'last', registry);
  const w = u.players.find((p) => p.name === 'Victor Wembanyama'); assert.equal(w.nbaId, 111); assert.equal(w.nbaIdSource, 'registry-name');
  assert.ok(u.players.filter((p) => p.name.startsWith('Dup Name')).every((p) => p.nbaId === null || p.nbaIdSource === 'registry'), 'an ambiguous name must not be matched to either id');
  assert.equal(u.players.find((p) => p.name === 'Dup Name').nbaId, null);
});
test('pipeline sync: tampered file (checksum), unvalidated manifest, bad path, row-count mismatch -> rejected, existing data untouched', async () => {
  const out = await publishFixture(); const { repo } = fresh(); repo.importCsv('last', 'player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + Array.from({ length: 30 }, (_, i) => `K${i},DEN,50,1500,300,600,60,150,100,130,300,200,50,30,100,${800 + i}`).join('\n'));
  const keep = JSON.stringify(repo.getDataset('last').rows);
  const m = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const text = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  const csv = await readFile(join(out, m.path, 'recent10.csv'), 'utf8');
  const cases = [
    ['checksum', { [`${m.path}/recent10.csv`]: { ok: true, status: 200, text: async () => csv.replace(/\n/, '\n#') } }, /SHA-256/],
    ['not validated', { 'manifest.json': text({ ...m, validation: { status: 'failed' } }) }, /沒有通過驗證/],
    ['bad path', { 'manifest.json': text({ ...m, path: '../etc' }) }, /版本路徑/],
    ['missing registry', { 'manifest.json': text({ ...m, files: Object.fromEntries(Object.entries(m.files).filter(([k]) => k !== 'player_registry.json')) }) }, /缺少必要檔案/],
    ['http error', { 'manifest.json': { ok: false, status: 404, json: async () => ({}), text: async () => '' } }, /HTTP 404/],
    ['network error', { 'manifest.json': new Error('offline') }, /offline/],
  ];
  for (const [name, override, re] of cases) {
    const r = await repo.syncPipeline(BASE, { fetchImpl: serve(out, { override }), force: true });
    assert.equal(r.ok, false, name); assert.match(r.error, re, name);
    assert.equal(JSON.stringify(repo.getDataset('last').rows), keep, `${name}: previous data must be untouched`); assert.equal(repo.getDataset('recent10'), null, `${name}: nothing partially committed`); assert.equal(repo.registry, null);
    assert.equal(repo.sync.state, 'failed'); assert.match(repo.sync.message, /繼續使用上次有效資料/); assert.ok(repo.pipelineMeta.lastError);
  }
  assert.equal((await repo.syncPipeline('ftp://x', {})).ok, false);
  await rm(out, { recursive: true });
});
test('pipeline sync: storage quota failure midway rolls EVERYTHING back (no mixed vintages)', async () => {
  const out = await publishFixture(); const backend = createMemoryBackend(); const orig = backend.setItem; let allowed = 3;
  backend.setItem = (k, v) => { if (/datasets\.[a-z0-9]+$/.test(k) && allowed >= 0 && allowed-- === 0) throw new Error('QuotaExceededError'); orig(k, v); };   // exactly ONE write fails (like a real quota hit); restores succeed
  const storage = createStorage(backend); const repo = createRepository({ storage }).init();
  repo.importCsv('current', 'player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + Array.from({ length: 30 }, (_, i) => `Old${i},DEN,5,150,30,60,6,15,10,13,30,20,5,3,10,${80 + i}`).join('\n')); allowed = 2;
  const before = JSON.stringify(repo.getDataset('current').rows);
  const r = await repo.syncPipeline(BASE, { fetchImpl: serve(out), force: true }); assert.equal(r.ok, false); assert.match(r.error, /已全部還原/);
  assert.equal(JSON.stringify(repo.getDataset('current').rows), before); assert.equal(repo.getDataset('last'), null); assert.equal(repo.getDataset('recent10'), null); assert.equal(repo.registry, null);
  assert.equal(JSON.stringify(createRepository({ storage }).init().getDataset('current').rows), before, 'and persisted state matches');
  await rm(out, { recursive: true });
});
test('pipeline sync: unchanged version is a no-op; manual imports survive unless forced; pre-season (empty current) keeps current untouched', async () => {
  const out = await publishFixture(); const { repo } = fresh();
  await repo.syncPipeline(BASE, { fetchImpl: serve(out) }); const w = repo.sync; void w;
  const again = await repo.syncPipeline(BASE, { fetchImpl: serve(out) }); assert.equal(again.unchanged, true);
  const mine = fresh(); mine.repo.importCsv('recent10', 'player,team,gp,min,fgm,fga,fg3m,fg3a,ftm,fta,reb,ast,stl,blk,tov,pts\n' + Array.from({ length: 30 }, (_, i) => `Mine${i},DEN,5,150,30,60,6,15,10,13,30,20,5,3,10,${80 + i}`).join('\n'), { label: 'mine.csv' });
  const r = await mine.repo.syncPipeline(BASE, { fetchImpl: serve(out) }); assert.equal(r.ok, true); assert.ok(r.skipped.includes('recent10')); assert.equal(mine.repo.getDataset('recent10').meta.source, 'import'); assert.ok(mine.repo.pipelineMeta.warnings.includes('manual-import-kept:recent10'));
  const f = await mine.repo.syncPipeline(BASE, { fetchImpl: serve(out), force: true }); assert.equal(f.ok, true); assert.equal(mine.repo.getDataset('recent10').meta.source, 'pipeline');
  const pre = clone(FX); pre.gameLog['2026-27'].resultSets[0].rowSet = []; pre.dash['2026-27'].resultSets[0].rowSet = [];
  const out2 = await publishFixture(pre, new Date('2026-10-14T06:00:00Z')); const p = fresh();
  const rp = await p.repo.syncPipeline(BASE, { fetchImpl: serve(out2) }); assert.equal(rp.ok, true); assert.deepEqual(rp.committed, ['last']); assert.deepEqual(rp.skipped.sort(), ['current', 'recent10', 'recent30d']);
  assert.equal(p.repo.getDataset('current'), null); assert.equal(p.repo.universe('current').used, 'last'); assert.ok(p.repo.universe('current').notes.some((n) => n.code === 'basis-fallback')); assert.equal(pipelineFreshness(p.repo.pipelineMeta).level, 'preseason');
  await rm(out, { recursive: true }); await rm(out2, { recursive: true });
});
test('pipeline sync: failed pipeline run is visible (status.json) while the last good data keeps serving', async () => {
  const out = await publishFixture(); const bad = clone(FX); bad.gameLog['2026-27'].resultSets[0].rowSet[10][28] = 'NaN';
  const res = await runPipeline({ season: 2026, outDir: out, now: new Date('2026-11-19T06:00:00Z'), client: clientFor(bad) }); assert.equal(res.status, 'failed');
  const { repo } = fresh(); const r = await repo.syncPipeline(BASE, { fetchImpl: serve(out) }); assert.equal(r.ok, true);
  assert.equal(repo.pipelineMeta.lastAttempt.ok, false); assert.equal(repo.pipelineMeta.lastAttempt.kind, 'invalid-source-data'); assert.ok(repo.getDataset('current').rows.length > 400);
  await rm(out, { recursive: true });
});
test('freshness levels: preseason / ok / warn / stale (in season only)', () => {
  const meta = (d, started = true) => ({ coverage: { current: { seasonStarted: started, sourceLastGameDate: d } } });
  assert.equal(pipelineFreshness(meta(null, false)).level, 'preseason');
  assert.equal(pipelineFreshness(meta('2026-11-17'), new Date('2026-11-18T12:00:00Z')).level, 'ok'); assert.equal(pipelineFreshness(meta('2026-11-12'), new Date('2026-11-18T12:00:00Z')).level, 'warn');
  assert.equal(pipelineFreshness(meta('2026-11-01'), new Date('2026-11-18T12:00:00Z')).level, 'stale'); assert.equal(pipelineFreshness(meta('2026-06-20'), new Date('2026-07-20T12:00:00Z')).level, 'ok');
  assert.equal(pipelineFreshness({}), null);
});
void sha256; void normalizeName;

// ---------- copy my draft order between leagues ----------
function leagues() {
  const { app } = fresh(); ['A', 'B', 'C', 'D'].forEach((n) => app.toggleMyRank(n)); app.addPlayer('Roster1'); app.setWeek(4); const main = app.activeId;
  app.addLeague('League 2'); const l2 = app.activeId; ['C', 'X'].forEach((n) => app.toggleMyRank(n)); app.addPlayer('OtherRoster');
  app.addLeague('League 3'); const l3 = app.activeId; app.switchLeague(main); return { app, main, l2, l3 };
}
test('copy order: merge keeps the target order and appends missing players; replace overwrites; nothing else in the target changes', () => {
  const { app, main, l2 } = leagues(); const target = () => app.profiles.find((p) => p.id === l2);
  const r = app.copyRank({ fromId: main, toIds: [l2], mode: 'merge' }); assert.equal(r.ok, true);
  assert.deepEqual(target().myRank, ['C', 'X', 'A', 'B', 'D']); assert.deepEqual(r.results[0], { id: l2, name: 'League 2', before: 2, after: 5, added: 3 });
  assert.deepEqual(target().selected, ['OtherRoster']); assert.equal(target().week, 4);   // untouched (inherited when the league was created)
  const r2 = app.copyRank({ fromId: main, toIds: [l2], mode: 'replace' }); assert.deepEqual(target().myRank, ['A', 'B', 'C', 'D']); assert.equal(r2.results[0].after, 4);
  assert.deepEqual(app.profiles.find((p) => p.id === main).myRank, ['A', 'B', 'C', 'D'], 'source untouched');
});
test('copy order: several targets at once, persisted, backup written; invalid requests change nothing', () => {
  const { app, main, l2, l3, } = leagues(); const storage = app.storage;
  const r = app.copyRank({ fromId: main, toIds: [l2, l3, l3, main, 'ghost'], mode: 'merge' }); assert.equal(r.ok, true); assert.deepEqual(r.results.map((x) => x.name).sort(), ['League 2', 'League 3']);
  assert.deepEqual(app.profiles.find((p) => p.id === l3).myRank, ['A', 'B', 'C', 'D']); assert.ok(storage.getJSON('backup.before-copy-rank'));
  assert.deepEqual(storage.getJSON('profiles').find((p) => p.id === l3).myRank, ['A', 'B', 'C', 'D']);
  const snap = JSON.stringify(app.profiles);
  assert.equal(app.copyRank({ fromId: l3 + 'x', toIds: [l2], mode: 'merge' }).ok, false); assert.equal(app.copyRank({ fromId: main, toIds: [], mode: 'merge' }).ok, false); assert.equal(app.copyRank({ fromId: main, toIds: [main], mode: 'merge' }).ok, false);
  assert.equal(app.copyRank({ fromId: main, toIds: [l2], mode: 'nope' }).ok, false);
  app.switchLeague(l2); app.clearMyRank(); const empty = app.copyRank({ fromId: l2, toIds: [main], mode: 'replace' }); assert.equal(empty.ok, false); assert.match(empty.error, /還沒有選人順位/); assert.equal(app.profiles.find((p) => p.id === main).myRank.length, 4);
  void snap;
});
