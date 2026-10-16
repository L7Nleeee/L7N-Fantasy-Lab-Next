// Orchestrator: fetch -> normalize -> aggregate -> registry -> VALIDATE -> publish. Network, clock and filesystem root are injectable.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNbaClient, SourceError } from './nba-client.mjs';
import { normalizeGameLog, latestDate } from './normalize.mjs';
import { aggregate, lastNGames, windowGames, toCsv, CSV_COLUMNS } from './aggregate.mjs';
import { buildRegistry } from './registry.mjs';
import { validateBundle } from './validate.mjs';
import { publish, readManifest, writeStatus, readStatus } from './publish.mjs';
import { seasonDisplay, seasonDefaults, sha256, stable, isoDay, isNum } from './util.mjs';

const FILES = { 'season_current.csv': 'current', 'recent10.csv': 'recent10', 'recent30d.csv': 'recent30d', 'season_previous.csv': 'last' };

/** Minimal reader for the CSV this pipeline writes (quotes supported). */
export function readOwnCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => {
    if (h === 'player' || h === 'team') return [h, r[i]];
    return [h, r[i] === '' ? null : Number(r[i])];
  })));
}

export async function runPipeline({ season, outDir, now = new Date(), client, fetchImpl, thresholds = {}, forcePrevious = false, requireCrossCheck = true, checkHeadshots = null, keep = 6, hooks = {}, log = () => {}, seasonStart, seasonEnd }) {
  const started = now.toISOString(); const today = isoDay(now);
  const cur = seasonDisplay(season); const prev = seasonDisplay(season - 1);
  const dates = { ...seasonDefaults(season), ...(seasonStart ? { seasonStart } : {}), ...(seasonEnd ? { seasonEnd } : {}) };
  client ||= createNbaClient({ fetchImpl });
  const fail = async (kind, message, extra = {}) => {
    await writeStatus(outDir, { lastAttempt: { at: started, ok: false, kind, message, ...extra } });
    log(`FAILED (${kind}): ${message}`); return { status: 'failed', kind, message, ...extra };
  };
  try {
    const prevManifest = await readManifest(outDir);
    const prevRegistry = prevManifest ? await readFile(join(outDir, prevManifest.path, 'player_registry.json'), 'utf8').then(JSON.parse).catch(() => null) : null;

    // ---- fetch (sequential, restrained) ----
    log(`fetching ${cur} game logs…`);
    const curLog = normalizeGameLog(await client.gameLog(cur));
    const reusePrev = !forcePrevious && prevManifest?.previousSeason?.display === prev && prevManifest.files?.['season_previous.csv'];
    let prevGames = []; let prevRows; let dashPrev = null;
    if (reusePrev) {
      const text = await readFile(join(outDir, prevManifest.path, 'season_previous.csv'), 'utf8');
      if (sha256(text) !== prevManifest.files['season_previous.csv'].sha256) throw new Error('published season_previous.csv does not match its manifest checksum');
      prevRows = readOwnCsv(text); log(`reusing immutable ${prev} dataset`);
    } else {
      log(`fetching ${prev} game logs…`); const pl = normalizeGameLog(await client.gameLog(prev));
      if (pl.invalid.length) return await fail('invalid-source-data', `${pl.invalid.length} invalid ${prev} game rows (first: ${pl.invalid[0].reason})`);
      prevGames = pl.games; prevRows = aggregate(prevGames);
      dashPrev = await client.dashTotals(prev).catch((e) => { if (requireCrossCheck) throw e; return null; });
    }
    if (curLog.invalid.length) return await fail('invalid-source-data', `${curLog.invalid.length} invalid ${cur} game rows (first: ${curLog.invalid[0].reason})`, { invalid: curLog.invalid.slice(0, 10) });
    const dashCur = await client.dashTotals(cur).catch((e) => { if (requireCrossCheck) throw e; return null; });
    const roster = await client.allPlayers(cur);

    // ---- build datasets ----
    const games = curLog.games; const lastGame = latestDate(games) || null; const firstGame = games.length ? games.reduce((m, g) => (g.date < m ? g.date : m), '9999') : null;
    const w30 = windowGames(games, lastGame, 30);
    const currentRows = aggregate(games); const r10 = aggregate(lastNGames(games, 10)); const r30 = aggregate(w30.games);
    const registry = buildRegistry({ season: cur, previousSeason: prev, roster, currentGames: games, previousGames: prevGames, previousSeasonIds: reusePrev ? new Set(prevRows.map((r) => r.player_id)) : null, previousRegistry: prevRegistry });
    if (checkHeadshots) {
      const ids = currentRows.slice().sort((a, b) => b.min - a.min).slice(0, 12).map((r) => r.player_id);
      const res = await checkHeadshots(ids.length ? ids : registry.players.filter((p) => p.current).slice(0, 12).map((p) => p.id));
      registry.headshotCheck = { ...res, at: started };
    }

    // ---- validate (critical failures block publishing) ----
    const report = validateBundle({
      today, ...dates, thresholds, requireCrossCheck, previousManifest: prevManifest, previousRegistry: prevRegistry, registry, dashCurrent: dashCur, dashPrevious: dashPrev,
      current: { rows: currentRows, games, meta: { season: cur, sourceLastGameDate: lastGame } }, previous: { rows: prevRows, games: prevGames },
      recent10: { rows: r10 }, recent30d: { rows: r30, meta: { dateFrom: w30.dateFrom, dateTo: w30.dateTo } },
    });
    if (registry.headshotCheck && registry.headshotCheck.checked > 0 && registry.headshotCheck.ok / registry.headshotCheck.checked < 0.8) report.warnings.push(`headshots: only ${registry.headshotCheck.ok}/${registry.headshotCheck.checked} sampled NBA CDN images reachable from this runner (the app falls back to initials)`);
    if (!report.ok) return await fail('validation', `${report.errors.length} critical validation failure(s): ${report.errors.slice(0, 3).join(' | ')}`, { errors: report.errors, warnings: report.warnings });

    // ---- assemble files + manifest ----
    const files = { 'season_current.csv': toCsv(currentRows), 'recent10.csv': toCsv(r10), 'recent30d.csv': toCsv(r30), 'season_previous.csv': reusePrev ? await readFile(join(outDir, prevManifest.path, 'season_previous.csv'), 'utf8') : toCsv(prevRows), 'player_registry.json': JSON.stringify(registry, null, 1) + '\n' };
    const meta = {};
    const rowsOf = { 'season_current.csv': currentRows, 'recent10.csv': r10, 'recent30d.csv': r30, 'season_previous.csv': prevRows };
    for (const [name, text] of Object.entries(files)) meta[name] = { rows: rowsOf[name]?.length ?? registry.players.length, uniquePlayers: rowsOf[name] ? new Set(rowsOf[name].map((r) => r.player_id)).size : registry.players.length, sha256: sha256(text), bytes: Buffer.byteLength(text), ...(FILES[name] ? { basis: FILES[name] } : {}) };
    const contentHash = sha256(stable(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.sha256]))));
    if (prevManifest?.contentHash === contentHash) {
      await writeStatus(outDir, { lastAttempt: { at: started, ok: true, kind: 'unchanged', message: 'source data unchanged; nothing to publish' } });
      log('unchanged'); return { status: 'unchanged', manifest: prevManifest };
    }
    const stamp = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const version = `${stamp}-${contentHash.slice(0, 8)}`;
    const manifest = {
      schema: 'l7n.dataset-manifest/1', datasetVersion: version, contentHash, generatedAt: started,
      season: { start: season, display: cur }, previousSeason: { start: season - 1, display: prev },
      source: { name: 'NBA Stats (stats.nba.com) — league game logs, regular season', endpoints: ['leaguegamelog', 'leaguedashplayerstats', 'commonallplayers'], fetchedAt: started, note: 'Unofficial endpoints without an SLA. Not a licensed data feed.' },
      coverage: {
        current: { dateFrom: firstGame, dateTo: lastGame, sourceLastGameDate: lastGame, seasonStarted: games.length > 0, teamGames: new Set(games.map((g) => g.gameId)).size },
        recent10: { rule: "each player's own latest 10 appearances (not the league's last 10 calendar days)", sourceLastGameDate: lastGame },
        recent30d: { dateFrom: w30.dateFrom, dateTo: w30.dateTo, days: 30 },
        previous: { season: prev, immutable: true, reused: !!reusePrev },
      },
      files: meta, registry: { players: registry.players.length, currentPlayers: registry.players.filter((p) => p.current).length, headshotTemplate: registry.headshotTemplate, headshotCheck: registry.headshotCheck },
      columns: CSV_COLUMNS,
      validation: { status: 'passed', checks: report.checks, warnings: report.warnings },
      path: `v/${version}`,
    };
    await publish({ outDir, version, files, manifest, keep, hooks });
    await writeStatus(outDir, { lastAttempt: { at: started, ok: true, kind: 'published', message: `published ${version}` }, lastSuccess: { at: started, datasetVersion: version, sourceLastGameDate: lastGame } });
    log(`published ${version}`); return { status: 'published', manifest };
  } catch (e) {
    const kind = e instanceof SourceError ? e.kind : 'internal';
    return await fail(kind, String(e?.message || e), { url: e?.url, attempts: e?.attempts });
  }
}
void isNum; void readStatus;
