#!/usr/bin/env node
// Usage: node pipeline/cli.mjs --season 2026 --out data [--fixture pipeline/fixtures/sample.json] [--force-previous] [--allow-no-crosscheck] [--check-headshots] [--now 2026-10-21T06:00:00Z]
import { readFile } from 'node:fs/promises';
import { runPipeline } from './src/build.mjs';
import { createFixtureClient } from './src/nba-client.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const season = Number(arg('season', new Date().getUTCMonth() >= 8 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1));
const outDir = arg('out', 'data');
let client;
if (arg('fixture')) {
  const fx = JSON.parse(await readFile(arg('fixture'), 'utf8'));
  client = createFixtureClient(fx);
}
const checkHeadshots = flag('check-headshots') ? async (ids) => {
  let ok = 0; const failed = [];
  for (const id of ids) { try { const r = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`, { method: 'HEAD' }); r.ok && /image/.test(r.headers.get('content-type') || '') ? ok++ : failed.push(id); } catch { failed.push(id); } }
  return { checked: ids.length, ok, failed };
} : null;
const res = await runPipeline({ season, outDir, now: arg('now') ? new Date(arg('now')) : new Date(), client, forcePrevious: flag('force-previous'), requireCrossCheck: !flag('allow-no-crosscheck'), checkHeadshots, log: (m) => console.log(`[l7n-data] ${m}`) });
console.log(JSON.stringify({ status: res.status, kind: res.kind, message: res.message, version: res.manifest?.datasetVersion }));
process.exit(res.status === 'failed' ? 1 : 0);
