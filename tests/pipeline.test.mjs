// Data-pipeline tests: aggregation semantics, identity, validation, atomic publishing, failure fallback. Uses the synthetic fixture (NOT real data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildFixture } from '../pipeline/fixtures/generate.mjs';
import { aggregate, lastNGames, windowGames, toCsv } from '../pipeline/src/aggregate.mjs';
import { normalizeGameLog, ddTd } from '../pipeline/src/normalize.mjs';
import { buildRegistry } from '../pipeline/src/registry.mjs';
import { fetchJson, parseResultSet, createNbaClient, SourceError, gameLogUrl } from '../pipeline/src/nba-client.mjs';
import { runPipeline, readOwnCsv } from '../pipeline/src/build.mjs';
import { validateBundle } from '../pipeline/src/validate.mjs';
import { readManifest, readStatus } from '../pipeline/src/publish.mjs';
import { sha256, seasonDisplay } from '../pipeline/src/util.mjs';

const sh = promisify(execFile);
const FX = buildFixture();
const NOW = new Date('2026-11-18T06:00:00Z');
const clone = (x) => structuredClone(x);
const clientFor = (fx, { onCall } = {}) => ({
  gameLog: async (s) => { onCall?.('gameLog', s); return parseResultSet(clone(fx.gameLog[s])); },
  dashTotals: async (s) => { onCall?.('dash', s); return parseResultSet(clone(fx.dash[s])); },
  allPlayers: async () => { onCall?.('players'); return parseResultSet(clone(fx.allPlayers)); },
});
const dir = async () => mkdtemp(join(tmpdir(), 'l7n-data-'));
const run = (o) => runPipeline({ season: 2026, now: NOW, ...o });
const snapshot = async (out) => { const m = await readManifest(out); const files = {}; if (m) for (const f of Object.keys(m.files)) files[f] = await readFile(join(out, m.path, f), 'utf8'); return { m, files, versions: m ? await readdir(join(out, 'v')) : [] }; };
const G = (o) => ({ playerId: 1, name: 'A', team: 'AAA', gameId: 'g1', date: '2026-10-21', min: 30, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pts: 0, ...o });

// ---------- aggregation semantics ----------
test('aggregate: per-game stats are totals, percentages are TOTAL makes / TOTAL attempts (not mean of game percentages)', () => {
  const rows = aggregate([G({ gameId: 'a', fgm: 10, fga: 20, ftm: 2, fta: 2, fg3m: 1, fg3a: 2, pts: 23 }), G({ gameId: 'b', date: '2026-10-23', fgm: 1, fga: 10, ftm: 0, fta: 8, fg3m: 0, fg3a: 5, pts: 2 })]);
  const r = rows[0];
  assert.equal(r.gp, 2); assert.equal(r.pts, 25); assert.equal(r.fgm, 11); assert.equal(r.fga, 30);
  assert.equal(r.fg_pct, Number((11 / 30).toFixed(6)));            // 0.366667, NOT (0.5 + 0.1) / 2 = 0.3
  assert.notEqual(r.fg_pct, 0.3); assert.equal(r.ft_pct, Number((2 / 10).toFixed(6))); assert.equal(r.fg3_pct, Number((1 / 7).toFixed(6)));
});
test('aggregate: zero attempts -> null percentage (never 0); empty input -> no rows', () => {
  assert.equal(aggregate([G({})])[0].fg_pct, null); assert.equal(aggregate([G({})])[0].ft_pct, null); assert.deepEqual(aggregate([]), []);
});
test('aggregate: DD / TD use the standard definition and the latest game decides team; output order is deterministic', () => {
  assert.deepEqual(ddTd(G({ pts: 20, reb: 10 })), { dd: 1, td: 0 }); assert.deepEqual(ddTd(G({ pts: 10, reb: 10, ast: 10 })), { dd: 1, td: 1 }); assert.deepEqual(ddTd(G({ pts: 9, reb: 10 })), { dd: 0, td: 0 });
  const r = aggregate([G({ gameId: 'x', date: '2026-10-21', team: 'OLD', pts: 10, reb: 10 }), G({ gameId: 'y', date: '2026-11-01', team: 'NEW', pts: 12 })])[0];
  assert.equal(r.team, 'NEW'); assert.equal(r.dd, 1);
  const a = aggregate([G({ playerId: 2, name: 'B' }), G({ playerId: 1, name: 'A' })]); assert.deepEqual(a.map((x) => x.player), ['A', 'B']);
});
test('recent10: each player\'s OWN last 10 appearances (not league calendar days); fewer games -> all of them', () => {
  const games = []; for (let i = 0; i < 25; i++) games.push(G({ gameId: `s${i}`, date: `2026-10-${String(21 + i).padStart(2, '0') > '31' ? '31' : String(21 + i).padStart(2, '0')}`, pts: i }));
  for (let i = 0; i < 25; i++) games[i].date = new Date(Date.UTC(2026, 9, 21 + i * 3)).toISOString().slice(0, 10);   // a player whose last 10 games span 27 days
  const slow = []; for (let i = 0; i < 4; i++) slow.push(G({ playerId: 2, name: 'B', gameId: `b${i}`, date: new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10), pts: 100 + i }));
  const out = lastNGames([...games, ...slow], 10);
  const a = out.filter((g) => g.playerId === 1); const b = out.filter((g) => g.playerId === 2);
  assert.equal(a.length, 10); assert.equal(Math.min(...a.map((g) => g.pts)), 15); assert.equal(b.length, 4);
  const agg = aggregate(out); assert.ok(agg.every((r) => r.gp <= 10));
});
test('recent30d: inclusive 30-day calendar window ending at the source\'s last game date', () => {
  const games = ['2026-10-19', '2026-10-20', '2026-11-18'].map((d, i) => G({ gameId: `w${i}`, date: d }));
  const w = windowGames(games, '2026-11-18', 30);
  assert.equal(w.dateFrom, '2026-10-20'); assert.equal(w.dateTo, '2026-11-18'); assert.deepEqual(w.games.map((g) => g.date), ['2026-10-20', '2026-11-18']);
  assert.deepEqual(windowGames([], null), { dateFrom: null, dateTo: null, games: [] });
});
test('normalize: invalid rows are reported (never zeroed); exact duplicates are dropped; conflicting duplicates are errors', () => {
  const base = { PLAYER_ID: 1, PLAYER_NAME: 'A', TEAM_ABBREVIATION: 'AAA', GAME_ID: 'g', GAME_DATE: '2026-10-21T00:00:00', MIN: 30, FGM: 3, FGA: 6, FG3M: 1, FG3A: 2, FTM: 0, FTA: 0, REB: 1, AST: 1, STL: 0, BLK: 0, TOV: 1, PTS: 7 };
  const n = normalizeGameLog([base, { ...base }, { ...base, GAME_ID: 'h', PTS: null }, { ...base, GAME_ID: 'i', FGM: 9 }, { ...base, GAME_ID: 'j', PLAYER_ID: 'x' }, { ...base, PTS: 99 }]);
  assert.equal(n.games.length, 1); assert.equal(n.duplicates, 1); assert.deepEqual(n.invalid.map((x) => x.reason).sort(), ['bad PLAYER_ID', 'bad PTS', 'conflicting duplicate (player, game)', 'makes exceed attempts']);
  assert.equal(n.games[0].date, '2026-10-21');
});
test('csv writer / reader round-trip including quoted names and empty percentages', () => {
  const rows = aggregate([G({ playerId: 5, name: 'Last, "Nick" First', fgm: 1, fga: 2 })]); const back = readOwnCsv(toCsv(rows));
  assert.equal(back[0].player, 'Last, "Nick" First'); assert.equal(back[0].fg_pct, 0.5); assert.equal(back[0].ft_pct, null); assert.equal(back[0].player_id, 5);
});

// ---------- registry ----------
test('registry: players with zero games stay (roster + previous registry), aliases merge, and it never shrinks', () => {
  const roster = [{ PERSON_ID: 7, DISPLAY_FIRST_LAST: 'Injured Star', ROSTERSTATUS: 1, TEAM_ABBREVIATION: 'IND' }, { PERSON_ID: 8, DISPLAY_FIRST_LAST: 'New Signee', ROSTERSTATUS: 1, TEAM_ABBREVIATION: 'BOS' }];
  const r1 = buildRegistry({ season: '2026-27', previousSeason: '2025-26', roster, currentGames: [G({ playerId: 1, name: 'Played A' })], previousGames: [G({ playerId: 7, name: 'Injured Star' }), G({ playerId: 9, name: 'Retired Guy' })] });
  const by = new Map(r1.players.map((p) => [p.id, p]));
  assert.ok(by.get(7).current && by.get(7).lastSeason); assert.ok(by.get(8).current && !by.get(8).lastSeason); assert.equal(by.get(8).seasonsSeen.length, 0);
  assert.ok(by.get(9) && !by.get(9).current);                         // played last season only: still known
  const r2 = buildRegistry({ season: '2026-27', previousSeason: '2025-26', roster: [], currentGames: [G({ playerId: 1, name: 'Played A. Jr' })], previousGames: [], previousRegistry: r1 });
  assert.equal(r2.players.length, r1.players.length); assert.ok(r2.players.find((p) => p.id === 7)); assert.ok(r2.players.find((p) => p.id === 1).aliases.length >= 0);
  assert.match(r2.headshotTemplate, /cdn\.nba\.com\/headshots\/nba\/latest\/1040x760\/\{id\}\.png/);
});

// ---------- NBA client ----------
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('bad json'); return body; } });
test('client: retries 5xx / 429 with exponential backoff, then succeeds', async () => {
  const waits = []; let n = 0; const seq = [resp(503, {}), resp(429, {}), resp(200, { ok: 1 })];
  const out = await fetchJson('u', { fetchImpl: async () => seq[n++], sleepFn: async (ms) => waits.push(ms), random: () => 0 });
  assert.deepEqual(out, { ok: 1 }); assert.deepEqual(waits, [2000, 6000]);
});
test('client: 403 is classified "blocked" and NOT retried; exhausted 5xx fails with attempt count', async () => {
  let calls = 0; await assert.rejects(fetchJson('u', { fetchImpl: async () => { calls++; return resp(403, {}); }, sleepFn: async () => {} }), (e) => e instanceof SourceError && e.kind === 'blocked'); assert.equal(calls, 1);
  calls = 0; await assert.rejects(fetchJson('u', { retries: 2, fetchImpl: async () => { calls++; return resp(500, {}); }, sleepFn: async () => {}, random: () => 0 }), (e) => e.kind === 'http' && e.attempts === 3); assert.equal(calls, 3);
});
test('client: timeouts, network errors and malformed JSON are classified', async () => {
  await assert.rejects(fetchJson('u', { retries: 0, timeoutMs: 10, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) }), (e) => e.kind === 'timeout');
  await assert.rejects(fetchJson('u', { retries: 0, fetchImpl: async () => { throw new Error('ECONNRESET'); } }), (e) => e.kind === 'network');
  await assert.rejects(fetchJson('u', { retries: 0, fetchImpl: async () => resp(200, undefined) }), (e) => e.kind === 'malformed');
  assert.throws(() => parseResultSet({ nope: 1 }), (e) => e.kind === 'malformed'); assert.throws(() => parseResultSet({ resultSets: [{ headers: ['A'], rowSet: [] }] }, { requiredHeaders: ['B'] }), /missing expected columns: B/);
  assert.deepEqual(parseResultSet({ resultSets: [{ headers: ['A', 'B'], rowSet: [[1, 2]] }] }), [{ A: 1, B: 2 }]);
});
test('client: paces requests (gap between calls) and builds the expected season URLs', async () => {
  const urls = []; const waits = []; const c = createNbaClient({ gapMs: 1500, sleepFn: async (ms) => waits.push(ms), fetchImpl: async (u) => { urls.push(u); return resp(200, FX.allPlayers); } });
  await c.allPlayers('2026-27'); await c.allPlayers('2026-27');
  assert.deepEqual(waits, [1500]); assert.match(urls[0], /commonallplayers\?IsOnlyCurrentSeason=1&LeagueID=00&Season=2026-27/);
  assert.match(gameLogUrl('2026-27'), /leaguegamelog\?.*PlayerOrTeam=P&Season=2026-27&SeasonType=Regular%20Season/);
  assert.equal(seasonDisplay(2026), '2026-27'); assert.equal(seasonDisplay(1999), '1999-00');
});

// ---------- end-to-end publishing ----------
test('pipeline: publishes five files + manifest; checksums match; zero-GP star and a signee stay in the registry with no fake stats', async () => {
  const out = await dir(); const res = await run({ outDir: out, client: clientFor(FX) });
  assert.equal(res.status, 'published', res.message);
  const { m, files } = await snapshot(out);
  assert.equal(m.validation.status, 'passed'); assert.equal(m.season.display, '2026-27'); assert.equal(m.previousSeason.display, '2025-26'); assert.equal(m.coverage.current.sourceLastGameDate, '2026-11-17');
  for (const [name, meta] of Object.entries(m.files)) { assert.equal(sha256(files[name]), meta.sha256, name); assert.equal(Buffer.byteLength(files[name]), meta.bytes); }
  assert.deepEqual(Object.keys(m.files).sort(), ['player_registry.json', 'recent10.csv', 'recent30d.csv', 'season_current.csv', 'season_previous.csv']);
  const reg = JSON.parse(files['player_registry.json']); const hali = reg.players.find((p) => p.name === 'Tyrese Haliburton'); const signee = reg.players.find((p) => p.name === 'Fixture Signee');
  assert.ok(hali && hali.current && hali.lastSeason); assert.ok(signee && signee.current);
  const cur = readOwnCsv(files['season_current.csv']); assert.ok(!cur.some((r) => r.player_id === hali.id), 'no fabricated current row for the injured star');
  assert.ok(readOwnCsv(files['season_previous.csv']).some((r) => r.player_id === hali.id));
  assert.ok(!cur.some((r) => r.player_id === signee.id));
  assert.equal(reg.players.length, m.registry.players);
  const st = await readStatus(out); assert.equal(st.lastAttempt.ok, true); assert.equal(st.lastSuccess.datasetVersion, m.datasetVersion);
  await rm(out, { recursive: true });
});
test('pipeline: identical source data -> "unchanged": no new version, manifest untouched', async () => {
  const out = await dir(); const a = await run({ outDir: out, client: clientFor(FX) }); const before = await snapshot(out);
  const b = await run({ outDir: out, client: clientFor(FX), now: new Date('2026-11-18T12:00:00Z') });
  assert.equal(b.status, 'unchanged'); const after = await snapshot(out); assert.deepEqual(after.versions, before.versions); assert.equal(after.m.datasetVersion, a.manifest.datasetVersion);
  await rm(out, { recursive: true });
});
test('pipeline: season_previous is immutable (not refetched, byte-identical) unless forced', async () => {
  const out = await dir(); await run({ outDir: out, client: clientFor(FX) }); const first = await snapshot(out);
  const fx2 = clone(FX); const extra = fx2.gameLog['2026-27'].resultSets[0].rowSet[0].slice(); extra[6] = 'NEWGAME'; extra[7] = '2026-11-18T00:00:00'; fx2.gameLog['2026-27'].resultSets[0].rowSet.push(extra);
  const dRow = fx2.dash['2026-27'].resultSets[0].rowSet.find((r) => r[0] === extra[1]); dRow[2] += 1; dRow[15] += extra[28]; dRow[3] += extra[10]; dRow[4] += extra[11]; dRow[5] += extra[12]; dRow[6] += extra[14]; dRow[7] += extra[15]; dRow[8] += extra[17]; dRow[9] += extra[18]; dRow[10] += extra[22]; dRow[11] += extra[23]; dRow[12] += extra[24]; dRow[13] += extra[25]; dRow[14] += extra[26];
  const calls = []; const res = await run({ outDir: out, now: new Date('2026-11-19T06:00:00Z'), client: clientFor(fx2, { onCall: (k, s) => calls.push(`${k}:${s}`) }) });
  assert.equal(res.status, 'published', res.message);
  assert.ok(!calls.includes('gameLog:2025-26') && !calls.includes('dash:2025-26'), `previous season must not be refetched: ${calls}`);
  const second = await snapshot(out); assert.equal(second.files['season_previous.csv'], first.files['season_previous.csv']); assert.notEqual(second.m.datasetVersion, first.m.datasetVersion); assert.equal(second.versions.length, 2);
  assert.equal(second.m.coverage.previous.reused, true);
  const calls2 = []; await run({ outDir: out, now: new Date('2026-11-19T07:00:00Z'), forcePrevious: true, client: clientFor(fx2, { onCall: (k, s) => calls2.push(`${k}:${s}`) }) });
  assert.ok(calls2.includes('gameLog:2025-26'));
  await rm(out, { recursive: true });
});
test('pipeline: runs through the real HTTP client path (URL routing, headers, result-set parsing)', async () => {
  const out = await dir(); const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, ua: opts.headers['User-Agent'], ref: opts.headers.Referer });
    const season = /Season=(\d{4}-\d{2})/.exec(url)[1];
    const body = url.includes('leaguegamelog') ? FX.gameLog[season] : url.includes('leaguedashplayerstats') ? FX.dash[season] : FX.allPlayers;
    return resp(200, body);
  };
  const res = await run({ outDir: out, client: createNbaClient({ fetchImpl, gapMs: 0, sleepFn: async () => {} }) });
  assert.equal(res.status, 'published', res.message); assert.equal(seen.length, 5); assert.ok(seen.every((s) => /Mozilla/.test(s.ua) && s.ref === 'https://www.nba.com/'));
  await rm(out, { recursive: true });
});
test('pipeline: old versions are pruned, the manifest\'s version never is', async () => {
  const out = await dir(); let fx = clone(FX);
  for (let i = 0; i < 5; i++) {
    const rows = fx.gameLog['2026-27'].resultSets[0].rowSet; const r = rows[i * 7].slice(); r[6] = `X${i}`; r[7] = `2026-11-${String(10 + i).padStart(2, '0')}T00:00:00`; rows.push(r);
    const d = fx.dash['2026-27'].resultSets[0].rowSet.find((x) => x[0] === r[1]); d[2]++; d[3] += r[10]; d[4] += r[11]; d[5] += r[12]; d[6] += r[14]; d[7] += r[15]; d[8] += r[17]; d[9] += r[18]; d[10] += r[22]; d[11] += r[23]; d[12] += r[24]; d[13] += r[25]; d[14] += r[26]; d[15] += r[28];
    const dd = [r[28], r[22], r[23], r[24], r[25]].filter((v) => v >= 10).length; if (dd >= 2) d[16]++; if (dd >= 3) d[17]++;
    const res = await run({ outDir: out, keep: 3, now: new Date(Date.UTC(2026, 10, 18, 6, i)), client: clientFor(fx) }); assert.equal(res.status, 'published', res.message);
  }
  const s = await snapshot(out); assert.equal(s.versions.length, 3); assert.ok(s.versions.includes(s.m.datasetVersion));
  await rm(out, { recursive: true });
});

// ---------- failure scenarios: the last known-good data must survive byte-for-byte ----------
async function failureCase(name, mutate, { expectKind, now, opts = {}, expectMessage } = {}) {
  test(`failure: ${name} -> nothing published, last good data intact, status.json says why`, async () => {
    const out = await dir(); const good = await run({ outDir: out, client: clientFor(FX) }); assert.equal(good.status, 'published', good.message);
    const before = await snapshot(out); const fx = clone(FX); const client = mutate(fx);
    const res = await run({ outDir: out, now: now ?? new Date('2026-11-19T06:00:00Z'), client: client ?? clientFor(fx), ...opts });
    assert.equal(res.status, 'failed', `expected failure, got ${res.status}`); if (expectKind) assert.equal(res.kind, expectKind, res.message); if (expectMessage) assert.match(res.message, expectMessage);
    const after = await snapshot(out); assert.deepEqual(after.files, before.files); assert.deepEqual(after.versions, before.versions); assert.equal(after.m.datasetVersion, before.m.datasetVersion);
    const st = await readStatus(out); assert.equal(st.lastAttempt.ok, false); assert.ok(st.lastAttempt.message); assert.equal(st.lastSuccess.datasetVersion, before.m.datasetVersion);
    await rm(out, { recursive: true });
  });
}
await failureCase('source blocks the runner (HTTP 403)', () => ({ gameLog: async () => { throw new SourceError('blocked', 'HTTP 403'); }, dashTotals: async () => [], allPlayers: async () => [] }), { expectKind: 'blocked' });
await failureCase('source keeps returning 503', () => ({ gameLog: async () => { throw new SourceError('http', 'HTTP 503', { attempts: 4 }); }, dashTotals: async () => [], allPlayers: async () => [] }), { expectKind: 'http' });
await failureCase('response shape changed (missing columns)', (fx) => { fx.gameLog['2026-27'].resultSets[0].headers = fx.gameLog['2026-27'].resultSets[0].headers.map((h) => (h === 'PTS' ? 'POINTS' : h)); return { gameLog: async (s) => parseResultSet(fx.gameLog[s], { requiredHeaders: ['PTS'] }), dashTotals: async () => [], allPlayers: async () => [] }; }, { expectKind: 'malformed' });
await failureCase('a game row has a non-numeric stat', (fx) => { fx.gameLog['2026-27'].resultSets[0].rowSet[10][28] = 'NaN'; }, { expectKind: 'invalid-source-data' });
await failureCase('a game row has makes > attempts', (fx) => { fx.gameLog['2026-27'].resultSets[0].rowSet[10][11] = 99; }, { expectKind: 'invalid-source-data' });
await failureCase('coverage collapses (only 6 teams in the current feed)', (fx) => { const rs = fx.gameLog['2026-27'].resultSets[0]; const keep = new Set(rs.rowSet.map((r) => r[4]).slice(0, 4000)); const teams = [...new Set(rs.rowSet.map((r) => r[4]))].slice(0, 6); rs.rowSet = rs.rowSet.filter((r) => teams.includes(r[4])); void keep; }, { expectKind: 'validation', expectMessage: /coverage:current/ });
await failureCase('feed is stale (latest game 60 days old, season still running)', () => null, { expectKind: 'validation', expectMessage: /freshness/, now: new Date('2027-01-16T06:00:00Z') });
await failureCase('cross-check mismatch for a sample player (Jokić points differ)', (fx) => { const row = fx.dash['2026-27'].resultSets[0].rowSet.find((r) => r[1] === 'Nikola Jokić'); row[15] += 3; }, { expectKind: 'validation', expectMessage: /sample-players:current/ });
await failureCase('season-totals endpoint unavailable while cross-check is required', (fx) => ({ gameLog: async (s) => parseResultSet(clone(fx.gameLog[s])), dashTotals: async () => { throw new SourceError('http', 'HTTP 500'); }, allPlayers: async () => parseResultSet(clone(fx.allPlayers)) }), { expectKind: 'http' });
await failureCase('the new feed has FEWER current players than what is already published', (fx) => { const rs = fx.gameLog['2026-27'].resultSets[0]; const drop = new Set(rs.rowSet.map((r) => r[1]).filter((_, i) => i % 5 === 0)); void drop; rs.rowSet = rs.rowSet.filter((r) => r[1] % 3 !== 0); fx.dash['2026-27'].resultSets[0].rowSet = fx.dash['2026-27'].resultSets[0].rowSet.filter((r) => r[0] % 3 !== 0); }, { expectKind: 'validation' });

test('failure: crash right before the manifest switch leaves the old manifest valid; next run recovers', async () => {
  const out = await dir(); await run({ outDir: out, client: clientFor(FX) }); const before = await snapshot(out);
  const fx = clone(FX); const rows = fx.gameLog['2026-27'].resultSets[0].rowSet; const r = rows[3].slice(); r[6] = 'CRASH'; r[7] = '2026-11-18T00:00:00'; rows.push(r);
  const d = fx.dash['2026-27'].resultSets[0].rowSet.find((x) => x[0] === r[1]); d[2]++; [[3, 10], [4, 11], [5, 12], [6, 14], [7, 15], [8, 17], [9, 18], [10, 22], [11, 23], [12, 24], [13, 25], [14, 26], [15, 28]].forEach(([i, j]) => { d[i] += r[j]; });
  const dd = [r[28], r[22], r[23], r[24], r[25]].filter((v) => v >= 10).length; if (dd >= 2) d[16]++; if (dd >= 3) d[17]++;
  const res = await run({ outDir: out, now: new Date('2026-11-19T06:00:00Z'), client: clientFor(fx), hooks: { beforeManifest: () => { throw new Error('simulated crash'); } } });
  assert.equal(res.status, 'failed'); const mid = await snapshot(out); assert.equal(mid.m.datasetVersion, before.m.datasetVersion); assert.deepEqual(mid.files, before.files);
  const ok = await run({ outDir: out, now: new Date('2026-11-19T06:05:00Z'), client: clientFor(fx) }); assert.equal(ok.status, 'published', ok.message);
  const after = await snapshot(out); assert.notEqual(after.m.datasetVersion, before.m.datasetVersion); assert.ok(!(await readdir(out)).some((n) => n.startsWith('.tmp-')));
  await rm(out, { recursive: true });
});

// ---------- season start / headshot check / validators ----------
test('season not started: publishes EMPTY current windows + full registry/previous (players do not vanish); too late after the opening date -> fails', async () => {
  const fx = clone(FX); fx.gameLog['2026-27'].resultSets[0].rowSet = []; fx.dash['2026-27'].resultSets[0].rowSet = [];
  const out = await dir(); const ok = await run({ outDir: out, now: new Date('2026-10-14T06:00:00Z'), client: clientFor(fx) });
  assert.equal(ok.status, 'published', ok.message); const { m, files } = await snapshot(out);
  assert.equal(m.coverage.current.seasonStarted, false); assert.equal(m.files['season_current.csv'].rows, 0); assert.equal(readOwnCsv(files['season_current.csv']).length, 0);
  assert.ok(m.files['season_previous.csv'].rows >= 400); assert.ok(m.registry.players >= 450);
  await rm(out, { recursive: true });
  const out2 = await dir(); const late = await run({ outDir: out2, now: new Date('2026-10-25T06:00:00Z'), client: clientFor(fx) });
  assert.equal(late.status, 'failed'); assert.match(late.message, /season-start/); await rm(out2, { recursive: true });
});
test('headshot reachability is recorded (and a poor result is a warning, not a data failure)', async () => {
  const out = await dir(); const res = await run({ outDir: out, client: clientFor(FX), checkHeadshots: async (ids) => ({ checked: ids.length, ok: 2, failed: ids.slice(2) }) });
  assert.equal(res.status, 'published'); assert.equal(res.manifest.registry.headshotCheck.checked, 12); assert.ok(res.manifest.validation.warnings.some((w) => /headshots/.test(w)));
  await rm(out, { recursive: true });
});
function goodBundle() {
  const games = normalizeGameLog(parseResultSet(clone(FX.gameLog['2026-27'])).map((r) => r)).games; const prevGames = normalizeGameLog(parseResultSet(clone(FX.gameLog['2025-26']))).games;
  const last = games.reduce((m, g) => (g.date > m ? g.date : m), ''); const w = windowGames(games, last, 30);
  const registry = buildRegistry({ season: '2026-27', previousSeason: '2025-26', roster: parseResultSet(clone(FX.allPlayers)), currentGames: games, previousGames: prevGames });
  return { today: '2026-11-18', seasonStart: '2026-10-15', seasonEnd: '2027-04-20', registry, requireCrossCheck: false,
    current: { rows: aggregate(games), games, meta: { season: '2026-27', sourceLastGameDate: last } }, previous: { rows: aggregate(prevGames), games: prevGames },
    recent10: { rows: aggregate(lastNGames(games, 10)) }, recent30d: { rows: aggregate(w.games), meta: { dateFrom: w.dateFrom, dateTo: w.dateTo } } };
}
test('validator: a clean bundle passes; recent10 with an 11th game, a wrong percentage, and a duplicate id each fail on their own check', () => {
  const b = goodBundle(); const ok = validateBundle(b); assert.equal(ok.ok, true, ok.errors.join('; '));
  const r10 = goodBundle(); r10.recent10.rows[0] = { ...r10.recent10.rows[0], gp: 11 }; const a = validateBundle(r10); assert.ok(a.errors.some((e) => e.startsWith('recent10')));
  const pct = goodBundle(); pct.current.rows[0] = { ...pct.current.rows[0], fg_pct: 0.999 }; assert.ok(validateBundle(pct).errors.some((e) => e.startsWith('percentages:season_current')));
  const dup = goodBundle(); dup.current.rows.push({ ...dup.current.rows[0] }); assert.ok(validateBundle(dup).errors.some((e) => e.startsWith('unique-ids:season_current')));
  const win = goodBundle(); win.recent30d.rows = win.recent30d.rows.slice(1); assert.ok(validateBundle(win).errors.some((e) => e.startsWith('recent30d')));
  const lost = goodBundle(); lost.previousRegistry = { players: [{ id: 123456789, name: 'Vanished' }] }; assert.ok(validateBundle(lost).errors.some((e) => e.startsWith('registry:monotonic')));
  const orphan = goodBundle(); orphan.registry = { ...orphan.registry, players: orphan.registry.players.slice(5) }; assert.ok(validateBundle(orphan).errors.some((e) => e.startsWith('registry:covers-datasets')));
});

// ---------- CLI ----------
test('CLI: exit code 0 on publish, 1 on failure; failure leaves status.json', async () => {
  const d = await dir(); const fxPath = join(d, 'fx.json'); const { truth, ...rest } = FX; void truth; await writeFile(fxPath, JSON.stringify(rest));
  const okRun = await sh('node', ['pipeline/cli.mjs', '--season', '2026', '--out', join(d, 'data'), '--fixture', fxPath, '--now', '2026-11-18T06:00:00Z']);
  assert.match(okRun.stdout, /"status":"published"/); assert.ok((await stat(join(d, 'data', 'manifest.json'))).isFile());
  const bad = clone(rest); bad.allPlayers.resultSets[0].headers = ['X']; await writeFile(fxPath, JSON.stringify(bad));
  await assert.rejects(sh('node', ['pipeline/cli.mjs', '--season', '2026', '--out', join(d, 'data2'), '--fixture', fxPath, '--now', '2026-11-18T06:00:00Z']), (e) => e.code === 1 && /"status":"failed"/.test(e.stdout));
  assert.equal((await readStatus(join(d, 'data2'))).lastAttempt.ok, false);
  await rm(d, { recursive: true });
});
