// League profile schema, versioned migration, export / import and share-link encoding. Pure (no DOM, no storage).
//   schemaVersion 1: legacy single-league keys (fb_*)  — migrated by migrateLegacyKeys()
//   schemaVersion 2: V4.0.21 profiles in l7n_h2h_leagues_v1
//   schemaVersion 3: this app
import { DEFAULT_WEIGHTS, DEFAULT_H2H_CATS, BASIS_IDS, clampMinGp } from '../engine/schema.js';
import { TEAMS } from '../data/static/teams.js';
import { WEEKS } from '../data/static/schedule.js';
import { WHATIF_MAX } from '../engine/whatif.js';

export const PROFILE_SCHEMA = 3;
export const CAND_SORTS = ['yahoo', 'myrank', 'teamfit', 'basefit', 'pts', '3pm', 'ftm', 'reb', 'ast', 'stl', 'blk', 'fg', 'ft', 'tov', 'dd', 'at', '3p'];
const KNOWN = new Set(['id', 'name', 'schemaVersion', 'selected', 'oppSelected', 'weights', 'h2hCategories', 'customH2HCats', 'savedOpponents', 'myRank', 'week', 'dataBasis', 'weeklyBasis', 'minGP', 'refMode',
  'overrides', 'teamOverrides', 'draftUnavailable', 'candSort', 'candAvailableOnly', 'whatIn', 'whatOut', 'extra']);
// Runtime-only fields that V4.0.21 happened to persist; dropped on purpose (not user settings).
const RUNTIME_ONLY = new Set(['tab', 'cand', 'playerSearch', 'oppSearch', 'rookieSearch', 'rookieFilter', 'sort', 'what', 'detail', 'rookieDetail', 'leagueId', 'leagues']);

export const newId = () => 'lg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
const strs = (a) => (Array.isArray(a) ? [...new Set(a.filter((n) => typeof n === 'string' && n))] : []);

export function makeProfile(name = '我的聯盟', id) {
  return {
    id: id || newId(), name, schemaVersion: PROFILE_SCHEMA,
    selected: [], oppSelected: [], weights: { ...DEFAULT_WEIGHTS }, h2hCategories: [...DEFAULT_H2H_CATS], customH2HCats: [], savedOpponents: [], myRank: [],
    week: 0, dataBasis: 'last', weeklyBasis: 'current', minGP: 20, refMode: 'top200',
    overrides: {}, teamOverrides: {}, draftUnavailable: [], candSort: 'yahoo', candAvailableOnly: false, whatIn: [], whatOut: [], extra: {},
  };
}

/** Validate + migrate any profile-shaped object to the current schema. Never throws; never drops unknown settings (kept in `extra`). */
export function normalizeProfile(p) {
  const raw = p && typeof p === 'object' ? p : {};
  const d = makeProfile(String(raw.name || '我的聯盟').slice(0, 80), raw.id);
  const from = Number(raw.schemaVersion) || 1;
  const o = { ...d };
  o.selected = strs(raw.selected); o.oppSelected = strs(raw.oppSelected);
  o.weights = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS)) { const v = Number(raw.weights?.[k]); if (raw.weights && k in raw.weights && Number.isFinite(v) && v >= 0) o.weights[k] = v; }
  o.h2hCategories = Array.isArray(raw.h2hCategories) ? raw.h2hCategories.filter((k) => DEFAULT_H2H_CATS.includes(k)) : [...DEFAULT_H2H_CATS];
  o.customH2HCats = Array.isArray(raw.customH2HCats) ? raw.customH2HCats.filter((k) => typeof k === 'string' && k.trim()) : [];
  o.savedOpponents = Array.isArray(raw.savedOpponents) ? raw.savedOpponents.filter((o) => o?.name && Array.isArray(o.players)) : [];
  o.myRank = strs(raw.myRank);
  o.draftUnavailable = strs(raw.draftUnavailable);
  o.candSort = CAND_SORTS.includes(raw.candSort) ? raw.candSort : 'yahoo';
  o.candAvailableOnly = !!raw.candAvailableOnly;
  o.minGP = clampMinGp(raw.minGP);
  // V4.0.21 rule: only profiles already at schema >= 2 may keep the 'league' pool; older ones are reset to top200.
  o.weeklyBasis = BASIS_IDS.includes(raw.weeklyBasis) ? raw.weeklyBasis : 'current';
  o.refMode = from >= 2 && raw.refMode === 'league' ? 'league' : (from >= 3 && raw.refMode === 'top200' ? 'top200' : 'top200');
  o.dataBasis = BASIS_IDS.includes(raw.dataBasis) ? raw.dataBasis : 'last';
  o.week = Number.isFinite(Number(raw.week)) ? Math.max(0, Math.min(WEEKS.length - 1, Math.trunc(Number(raw.week)))) : 0;
  o.overrides = {};
  for (const [k, v] of Object.entries(raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {})) { const n = Number(v); if (Number.isFinite(n)) o.overrides[k] = Math.max(0, Math.min(5, Math.round(n))); }
  o.teamOverrides = {};
  for (const [k, v] of Object.entries(raw.teamOverrides && typeof raw.teamOverrides === 'object' ? raw.teamOverrides : {})) if (TEAMS[v]) o.teamOverrides[k] = v;
  o.whatIn = strs(raw.whatIn).slice(0, WHATIF_MAX); o.whatOut = strs(raw.whatOut).slice(0, WHATIF_MAX);
  o.extra = raw.extra && typeof raw.extra === 'object' ? { ...raw.extra } : {};
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.has(k) && !RUNTIME_ONLY.has(k)) o.extra[k] = v;
  o.schemaVersion = PROFILE_SCHEMA;
  return o;
}

/** Build one profile out of the pre-V3.9 single-league localStorage keys. `read(key)` must be read-only. */
export function migrateLegacyKeys(read) {
  const j = (k, fb) => { try { const s = read(k); return s == null ? fb : JSON.parse(s); } catch { return fb; } };
  const has = ['fb_final_team', 'fb_opp_team', 'fb_weights', 'fb_week', 'fb_final_overrides'].some((k) => read(k) != null);
  if (!has) return null;
  return normalizeProfile({
    name: '我的聯盟', schemaVersion: 1,
    selected: j('fb_final_team', []), oppSelected: j('fb_opp_team', []), weights: j('fb_weights', {}),
    overrides: j('fb_final_overrides', {}), teamOverrides: j('fb_team_overrides', {}),
    dataBasis: read('fb_data_basis') || 'last', week: Number(read('fb_week') || 0) || 0, minGP: Math.max(20, Number(read('fb_min_gp') || 20) || 20),
    refMode: read('fb_ref_mode') || 'league',
  });
}

// ---------- export / import ----------
export function exportProfile(profile) {
  return { app: 'L7N H2H Fantasy Lab', kind: 'league-profile', schemaVersion: PROFILE_SCHEMA, exportedAt: new Date().toISOString(), profile: normalizeProfile(profile) };
}
export function exportAll(profiles, activeId) {
  return { app: 'L7N H2H Fantasy Lab', kind: 'all-leagues', schemaVersion: PROFILE_SCHEMA, exportedAt: new Date().toISOString(), activeId, profiles: profiles.map(normalizeProfile) };
}

/** Accepts: our league-profile / all-leagues exports, or a V4.0.21 config (`version:4`). @returns {{profiles:object[], warnings:string[]}|{error:string}} */
export function parseImport(json) {
  let j = json;
  if (typeof json === 'string') { try { j = JSON.parse(json); } catch { return { error: '不是有效的 JSON 檔案。' }; } }
  if (!j || typeof j !== 'object') return { error: '檔案內容不是設定物件。' };
  const warnings = [];
  const ver = Number(j.schemaVersion ?? j.version);
  if (Number.isFinite(ver) && ver > PROFILE_SCHEMA && j.kind) warnings.push(`檔案版本 ${ver} 比本程式新，未知欄位會被保留但可能不生效。`);
  if (j.kind === 'all-leagues' && Array.isArray(j.profiles)) {
    const profiles = j.profiles.map((p) => normalizeProfile({ ...p, id: newId() }));
    if (!profiles.length) return { error: '備份檔內沒有任何聯盟。' };
    return { profiles, warnings };
  }
  if (j.kind === 'league-profile' && j.profile) return { profiles: [normalizeProfile({ ...j.profile, id: newId() })], warnings };
  if (j.selected || j.team || j.weights || j.leagueName) { // V4.0.21 export / share payload
    const p = normalizeProfile({
      name: j.leagueName || j.name || '匯入的聯盟', schemaVersion: Number(j.version) >= 4 ? 2 : 1,
      selected: j.selected || j.team, oppSelected: j.opponent || j.opp, weights: j.weights, h2hCategories: j.h2hCategories, myRank: j.myRank,
      week: j.week, dataBasis: j.dataBasis, overrides: j.overrides, teamOverrides: j.teamOverrides, minGP: j.minGP, refMode: j.refMode, id: newId(),
    });
    warnings.push('已把 V4.0.21 設定轉換為新版格式。');
    return { profiles: [p], warnings };
  }
  return { error: '無法辨識這個設定檔（不是 L7N 匯出檔）。' };
}

// ---------- share link (#share=…), compatible with V4.0.21 payloads ----------
export function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decodeUtf8(b64) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function encodeShare(p) {
  return b64encodeUtf8(JSON.stringify({ version: 4, leagueName: p.name, team: p.selected, opp: p.oppSelected, weights: p.weights, h2hCategories: p.h2hCategories,
    myRank: p.myRank, week: p.week, dataBasis: p.dataBasis, overrides: p.overrides, teamOverrides: p.teamOverrides, minGP: p.minGP, refMode: p.refMode }));
}
export function decodeShare(hash) {
  const m = String(hash || '').match(/^#share=(.+)$/); if (!m) return null;
  try {
    const j = JSON.parse(b64decodeUtf8(m[1]));
    const p = normalizeProfile({ ...j, name: String(j.leagueName || '分享聯盟').slice(0, 60) + ' · Shared', selected: j.team, oppSelected: j.opp, schemaVersion: 2, id: newId() });
    return p;
  } catch { return null; }
}
