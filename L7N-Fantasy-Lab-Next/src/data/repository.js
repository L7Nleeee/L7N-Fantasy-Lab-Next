// Dataset repository: keeps up to three independent datasets (last / current / recent10),
// validates before writing, replaces atomically, and never clobbers the previous good data on failure.
import { recordsFromCsv } from './csv.js';
import { buildUniverse } from './universe.js';
import { BASIS_IDS, DATA_BASES } from '../engine/schema.js';
import { normalizeName, num } from '../engine/util.js';

export const DEFAULT_BASELINE_URL = 'https://raw.githubusercontent.com/rx-src/nba-analysis/main/nba_player_stats_2026.csv';
export const MIN_IMPORT_ROWS = 20;
export const MIN_REMOTE_ROWS = 400;
const LEGACY = { last: 'fb_custom_dataset_last', current: 'fb_custom_dataset_current', recent10: 'fb_custom_dataset_recent10' };

export function createRepository({ storage, now = () => new Date().toISOString() }) {
  const datasets = { last: null, current: null, recent10: null, recent30d: null };
  let registry = storage.getJSON('registry', null); let pipelineMeta = storage.getJSON('pipeline.meta', null);
  const listeners = new Set();
  let revision = 0;
  const sync = { state: 'idle', message: '', at: null };

  const emit = () => { revision++; listeners.forEach((fn) => fn(repo)); };
  const setSync = (state, message) => { sync.state = state; sync.message = message; sync.at = now(); listeners.forEach((fn) => fn(repo)); };

  function validateRecords(records, minRows) {
    if (!Array.isArray(records)) return '資料格式不是陣列。';
    const withStats = records.filter((r) => r && r.name && r.status === 'ok').length;
    if (withStats < minRows) return `有效球員資料只有 ${withStats} 筆（至少需要 ${minRows} 筆），已保留原本資料。`;
    return null;
  }

  /** Validate -> write temp -> read back -> write final. In-memory state changes only after the final write succeeds. */
  function commitDataset(basis, records, meta, minRows, { silent = false } = {}) {
    if (!BASIS_IDS.includes(basis)) return { ok: false, error: '未知的資料基準。' };
    const bad = validateRecords(records, minRows);
    if (bad) return { ok: false, error: bad };
    const full = { meta: { basis, season: DATA_BASES[basis].season, period: DATA_BASES[basis].period, updatedAt: now(), rows: records.length, ...meta }, rows: records };
    const tmp = storage.setJSON(`datasets.${basis}.tmp`, full);
    if (!tmp.ok) return { ok: false, error: '無法寫入瀏覽器儲存空間：' + tmp.error + '（已保留原本資料）' };
    const back = storage.getJSON(`datasets.${basis}.tmp`);
    if (!back || back.rows?.length !== records.length) { storage.remove(`datasets.${basis}.tmp`); return { ok: false, error: '寫入後驗證失敗，已保留原本資料。' }; }
    const fin = storage.setJSON(`datasets.${basis}`, full);
    storage.remove(`datasets.${basis}.tmp`);
    if (!fin.ok) return { ok: false, error: '無法寫入瀏覽器儲存空間：' + fin.error + '（已保留原本資料）' };
    datasets[basis] = full; if (!silent) emit();
    return { ok: true, count: records.length, meta: full.meta };
  }

  const repo = {
    get revision() { return revision; },
    get sync() { return sync; },
    get registry() { return registry; },
    get pipelineMeta() { return pipelineMeta; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getDataset: (basis) => datasets[basis],
    datasetsSnapshot: () => ({ ...datasets }),

    /** Load saved datasets; one-time READ-ONLY copy from V4.0.21 localStorage keys when we have nothing yet. */
    init() {
      for (const b of BASIS_IDS) {
        const d = storage.getJSON(`datasets.${b}`);
        if (d && Array.isArray(d.rows) && d.rows.length) datasets[b] = d;
      }
      for (const b of BASIS_IDS) {
        if (datasets[b]) continue;
        const raw = storage.readForeign(LEGACY[b]);
        if (!raw) continue;
        try {
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr) || arr.length < MIN_IMPORT_ROWS) continue;
          const recs = arr.filter((x) => x && x.name).map((x) => legacyToRecord(x));
          const srcTag = storage.readForeign('fb_dataset_source_' + b) || 'legacy';
          const res = commitDataset(b, recs, { source: 'legacy-v4', sourceLabel: `V4.0.21 本機資料（${srcTag}）`, legacy: true }, MIN_IMPORT_ROWS);
          if (res.ok) storage.setJSON('migration.datasets.' + b, { from: LEGACY[b], at: now(), rows: recs.length });
        } catch { /* ignore broken legacy payloads */ }
      }
      revision++;
      return repo;
    },

    importCsv(basis, text, { label = '', minRows = MIN_IMPORT_ROWS } = {}) {
      const parsed = recordsFromCsv(text, { allowBuiltinDd: basis === 'last' });
      if (parsed.errors.length) return { ok: false, error: parsed.errors.join(' '), warnings: parsed.warnings };
      const res = commitDataset(basis, parsed.records, { source: 'import', sourceLabel: label ? `匯入 CSV：${label}` : '匯入 CSV', mode: parsed.mode }, minRows);
      return { ...res, warnings: parsed.warnings, skipped: parsed.skipped, mode: parsed.mode };
    },

    /** Fetch the public baseline CSV. Any failure keeps the existing dataset. Never throws. */
    async syncRemote(basis = 'last', { fetchImpl = globalThis.fetch, url = DEFAULT_BASELINE_URL, timeoutMs = 8000, minRows = MIN_REMOTE_ROWS, force = false } = {}) {
      const existing = datasets[basis];
      if (!force && (existing?.meta?.source === 'import' || existing?.meta?.source === 'pipeline')) {
        setSync('skipped', existing.meta.source === 'pipeline' ? `${DATA_BASES[basis].short} 由 L7N 資料管線提供，未被舊版遠端資料覆蓋。` : `已使用你手動匯入的 ${DATA_BASES[basis].short} 資料，未被遠端資料覆蓋。`);
        return { ok: false, skipped: true };
      }
      if (typeof fetchImpl !== 'function') { setSync('failed', '此環境無法連線，使用已存的資料。'); return { ok: false, error: 'no fetch' }; }
      setSync('syncing', '正在同步資料…');
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl?.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: ctl?.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const parsed = recordsFromCsv(text, { allowBuiltinDd: basis === 'last' });
        if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
        const out = commitDataset(basis, parsed.records, { source: 'remote', sourceLabel: '遠端資料同步（rx-src/nba-analysis）', url, mode: parsed.mode }, minRows);
        if (!out.ok) throw new Error(out.error);
        setSync('ok', `已同步 ${out.count} 位球員。`);
        return out;
      } catch (e) {
        clearTimeout(timer);
        const why = e?.name === 'AbortError' ? '連線逾時' : String(e?.message || e);
        setSync('failed', `同步未成功（${why}），繼續使用${existing ? '上次成功的資料' : '內建種子資料'}。`);
        return { ok: false, error: why };
      }
    },

    /**
     * Sync from the L7N data pipeline (manifest.json + versioned files). All-or-nothing:
     * everything is downloaded and verified first; datasets are then committed together and rolled back if any write fails.
     */
    async syncPipeline(baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 20000, force = false } = {}) {
      const base = String(baseUrl || '').trim().replace(/\/+$/, '') + '/';
      if (!/^https?:\/\//i.test(base)) { setSync('failed', '資料管線網址格式不正確（需要 http(s):// 開頭）。'); return { ok: false, error: 'bad url' }; }
      if (typeof fetchImpl !== 'function') { setSync('failed', '此環境無法連線。'); return { ok: false, error: 'no fetch' }; }
      setSync('syncing', '正在同步 L7N 資料管線…');
      const get = async (path, parse) => {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const t = setTimeout(() => ctl?.abort(), timeoutMs);
        try { const r = await fetchImpl(base + path, { signal: ctl?.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return parse === 'json' ? await r.json() : await r.text(); }
        catch (e) { throw new Error(e?.name === 'AbortError' ? `${path}: 連線逾時` : String(e?.message || e)); } finally { clearTimeout(t); }
      };
      const lastAttempt = async () => { try { return (await get('status.json', 'json')).lastAttempt || null; } catch { return null; } };
      try {
        const m = await get('manifest.json', 'json');
        const bad = checkManifest(m); if (bad) throw new Error(`manifest 不可用：${bad}`);
        if (!force && pipelineMeta?.datasetVersion === m.datasetVersion && pipelineMeta.baseUrl === base) {
          pipelineMeta = { ...pipelineMeta, checkedAt: now(), lastAttempt: await lastAttempt() }; storage.setJSON('pipeline.meta', pipelineMeta);
          setSync('ok', '資料已是最新版本。'); return { ok: true, unchanged: true };
        }
        const texts = {}; const warnings = [];
        for (const name of Object.keys(m.files)) {
          const text = await get(`${m.path}/${name}`, 'text'); const meta = m.files[name];
          const sum = await sha256Hex(text);
          if (sum === null) { if (!warnings.includes('checksum-skipped')) warnings.push('checksum-skipped'); }
          else if (sum !== meta.sha256) throw new Error(`${name} 的 SHA-256 與 manifest 不符，已拒絕整批更新`);
          texts[name] = text;
        }
        const parsed = {}; const skipped = [];
        for (const [name, meta] of Object.entries(m.files)) {
          if (!meta.basis) continue;
          const p = recordsFromCsv(texts[name], { allowBuiltinDd: false });
          if (p.errors.length) throw new Error(`${name}：${p.errors.join(' ')}`);
          if (p.records.length !== meta.rows) throw new Error(`${name} 筆數 ${p.records.length} 與 manifest（${meta.rows}）不符`);
          if (p.records.length === 0) { skipped.push(meta.basis); continue; }          // e.g. season not started: keep whatever we have
          if (!force && datasets[meta.basis]?.meta?.source === 'import') { skipped.push(meta.basis); warnings.push(`manual-import-kept:${meta.basis}`); continue; }
          parsed[meta.basis] = { records: p.records, file: name, meta };
        }
        let reg; try { reg = JSON.parse(texts['player_registry.json']); } catch { throw new Error('player_registry.json 不是有效的 JSON'); }
        if (!Array.isArray(reg.players) || reg.players.length < 50) throw new Error('球員主檔內容不完整');
        // commit all-or-nothing
        const before = {}; for (const b of Object.keys(parsed)) before[b] = datasets[b];
        const done = [];
        const rollback = () => { let ok = true; for (const d of done) { if (before[d]) { if (!storage.setJSON(`datasets.${d}`, before[d]).ok) ok = false; datasets[d] = before[d]; } else { storage.remove(`datasets.${d}`); datasets[d] = null; } } return ok ? '（已全部還原）' : '（還原不完整，請重新同步）'; };
        for (const [b, x] of Object.entries(parsed)) {
          const r = commitDataset(b, x.records, { source: 'pipeline', sourceLabel: `L7N 資料管線 · ${m.datasetVersion}`, datasetVersion: m.datasetVersion, generatedAt: m.generatedAt, dateFrom: b === 'recent30d' ? m.coverage.recent30d.dateFrom : b === 'last' ? null : m.coverage.current.dateFrom, dateTo: b === 'recent30d' ? m.coverage.recent30d.dateTo : b === 'last' ? null : m.coverage.current.dateTo, sourceLastGameDate: m.coverage.current.sourceLastGameDate, mode: 'totals' }, 1, { silent: true });
          if (!r.ok) throw new Error(`寫入 ${DATA_BASES[b].short} 失敗：${r.error}${rollback()}`);
          done.push(b);
        }
        const w = storage.setJSON('registry', reg); if (!w.ok) throw new Error(`寫入球員主檔失敗：${w.error}${rollback()}`);
        registry = reg;
        pipelineMeta = { baseUrl: base, datasetVersion: m.datasetVersion, generatedAt: m.generatedAt, fetchedAt: now(), checkedAt: now(), season: m.season, previousSeason: m.previousSeason, source: m.source, coverage: m.coverage, files: Object.fromEntries(Object.entries(m.files).map(([k, v]) => [k, { rows: v.rows, uniquePlayers: v.uniquePlayers }])), registry: m.registry, warnings: [...(m.validation.warnings || []), ...warnings], emptyBases: skipped, lastAttempt: await lastAttempt() };
        storage.setJSON('pipeline.meta', pipelineMeta); emit();
        setSync('ok', `已同步 L7N 資料管線（${m.datasetVersion}）。`);
        return { ok: true, version: m.datasetVersion, committed: done, skipped };
      } catch (e) {
        const la = await lastAttempt();
        pipelineMeta = pipelineMeta ? { ...pipelineMeta, lastAttempt: la || pipelineMeta.lastAttempt, lastError: { at: now(), message: String(e.message || e) } } : { baseUrl: base, lastError: { at: now(), message: String(e.message || e) }, lastAttempt: la };
        storage.setJSON('pipeline.meta', pipelineMeta); listeners.forEach((fn) => fn(repo));
        setSync('failed', `L7N 資料管線同步未成功（${e.message || e}），繼續使用上次有效資料。`);
        return { ok: false, error: String(e.message || e) };
      }
    },
    hasPipelineData() { return BASIS_IDS.some((b) => datasets[b]?.meta?.source === 'pipeline'); },
    clearDataset(basis) { storage.remove(`datasets.${basis}`); datasets[basis] = null; emit(); },
    universe(basis) { return buildUniverse(datasets, basis, registry); },
    describe(basis) {
      const d = datasets[basis];
      return d ? { available: true, ...d.meta } : { available: false, basis, season: DATA_BASES[basis].season, period: DATA_BASES[basis].period };
    },
  };
  return repo;
}

function checkManifest(m) {
  if (!m || typeof m !== 'object') return '不是有效的 manifest';
  if (!String(m.schema || '').startsWith('l7n.dataset-manifest/')) return 'schema 不符';
  if (m.validation?.status !== 'passed') return '這份資料沒有通過驗證';
  if (!/^v\/[\w.\-]+$/.test(String(m.path || ''))) return '版本路徑不合法';
  if (typeof m.datasetVersion !== 'string' || !m.files || !m.files['player_registry.json']) return '缺少必要檔案';
  for (const [name, f] of Object.entries(m.files)) if (!/^[\w.\-]+$/.test(name) || !f?.sha256 || !Number.isInteger(f.rows)) return `${name} 的檔案資訊不完整`;
  if (!m.coverage?.current || !m.coverage?.recent30d) return '缺少涵蓋範圍資訊';
  return null;
}
async function sha256Hex(text) {
  const c = globalThis.crypto?.subtle; if (!c) return null;                 // insecure origins (file://, plain http) have no WebCrypto: checksum skipped + flagged
  const buf = await c.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Data freshness for the status area. Season months only; the pipeline's own validation enforces the hard limits. */
export function pipelineFreshness(meta, today = new Date()) {
  const cov = meta?.coverage?.current; if (!cov) return null;
  if (!cov.seasonStarted) return { level: 'preseason', ageDays: null, text: '本季尚未開打（本季資料為空，使用上季資料）' };
  const last = Date.parse(`${cov.sourceLastGameDate}T00:00:00Z`); const age = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - last) / 86400000);
  const m = today.getUTCMonth() + 1; const inSeason = m >= 10 || m <= 4;
  const level = !inSeason ? 'ok' : age > 7 ? 'stale' : age > 4 ? 'warn' : 'ok';
  return { level, ageDays: age, text: age >= 0 ? `最後一場比賽 ${cov.sourceLastGameDate}（${age} 天前）` : `最後一場比賽 ${cov.sourceLastGameDate}（晚於本機日期，請確認裝置時間）` };
}

function legacyToRecord(x) {
  const gp = num(x.gp) || 0;
  const minutes = num(x.minutes);
  return {
    id: normalizeName(x.name), name: x.name, baselineTeam: x.baselineTeam || x.team || null, position: x.position || null, gp, minutes,
    pts: num(x.pts), pm3: num(x.pm3), reb: num(x.reb), ast: num(x.ast), stl: num(x.stl), blk: num(x.blk), tov: num(x.tov),
    fg: num(x.fg), fga: num(x.fga), ft: num(x.ft), fta: num(x.fta), ftm: num(x.ftm), p3: num(x.p3), p3a: num(x.p3a),
    at: num(x.at), dd: num(x.dd), td: num(x.td), status: gp > 0 && num(x.pts) !== null ? 'ok' : 'no-games', ddSource: num(x.dd) !== null ? 'legacy' : null,
  };
}
