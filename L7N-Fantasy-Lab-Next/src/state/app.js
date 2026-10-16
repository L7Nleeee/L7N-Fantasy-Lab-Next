// Application controller: league profiles + persistence + memoized derived data (players / model).
// The UI talks to this object only; it owns no DOM. Every mutation goes through commit(topics, fn).
import { createStorage } from './storage.js';
import { makeProfile, normalizeProfile, migrateLegacyKeys, newId, decodeShare, exportProfile, exportAll, parseImport, PROFILE_SCHEMA } from './profiles.js';
import { buildModel } from '../engine/model.js';
import { SCHEDULE, WEEKS } from '../data/static/schedule.js';
import { TEAMS } from '../data/static/teams.js';
import { WHATIF_MAX } from '../engine/whatif.js';
import { normalizeName } from '../engine/util.js';
import { RULES, clampMinGp } from '../engine/schema.js';

export const TOPICS = ['league', 'roster', 'opp', 'weights', 'settings', 'week', 'games', 'teams', 'myrank', 'marks', 'candui', 'what', 'h2h', 'data', 'ui'];
const LEGACY_PROFILES_KEY = 'l7n_h2h_leagues_v1';
const LEGACY_ACTIVE_KEY = 'l7n_h2h_active_league_v1';

export function createApp({ storage = createStorage(), repo, now = () => new Date().toISOString() }) {
  const listeners = new Set();
  let profiles = []; let activeId = null;
  let settings = { photos: true, tab: 'draft', ...(storage.getJSON('settings', {}) || {}) };
  const boot = { notes: [], migrated: null };

  // ---------- load / migrate ----------
  function load() {
    const saved = storage.getJSON('profiles');
    if (Array.isArray(saved) && saved.length) {
      profiles = saved.map(normalizeProfile);
      activeId = storage.getJSON('active');
    } else {
      // First run of this app on this origin: copy (read-only) from V4.0.21 keys, keep a backup of what we read.
      let legacy = null;
      const raw = storage.readForeign(LEGACY_PROFILES_KEY);
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) {
            storage.setJSON('backup.legacy-v4-profiles', { at: now(), raw });
            profiles = arr.map(normalizeProfile);
            legacy = `已從 V4.0.21 複製 ${profiles.length} 個聯盟（原版資料未被修改）`;
            const la = storage.readForeign(LEGACY_ACTIVE_KEY); if (la && profiles.some((p) => p.id === la)) activeId = la;
          }
        } catch { boot.notes.push({ level: 'warn', text: '舊版聯盟資料損毀，無法轉換；已建立新聯盟。' }); }
      }
      if (!profiles.length) {
        const p = migrateLegacyKeys((k) => storage.readForeign(k));
        if (p) { profiles = [p]; legacy = '已從更早版本（fb_*）的設定建立聯盟'; }
      }
      if (!profiles.length) profiles = [makeProfile('我的聯盟')];
      boot.migrated = legacy;
    }
    if (!profiles.some((p) => p.id === activeId)) activeId = profiles[0].id;
    const shared = typeof location !== 'undefined' ? decodeShare(location.hash) : null;
    if (shared) {
      profiles.push(shared); activeId = shared.id; boot.notes.push({ level: 'info', text: `已從分享連結新增聯盟「${shared.name}」。` });
      try { history.replaceState(null, '', location.href.split('#')[0]); } catch { /* ignore */ }
    }
    persist();
  }

  let lastActive = null;
  function persist() {
    const a = storage.setJSON('profiles', profiles);
    const b = activeId === lastActive ? { ok: true } : storage.setJSON('active', activeId);
    if (b.ok) lastActive = activeId;
    if (!a.ok || !b.ok) boot.notes.push({ level: 'error', text: '無法儲存到瀏覽器（可能是空間已滿或無痕模式）。' + (a.error || b.error || '') });
    return a.ok && b.ok;
  }
  const emit = (topics) => { const t = new Set(topics); listeners.forEach((fn) => fn(t)); };

  // ---------- derived (memoized) ----------
  let uniKey = ''; let uni = null; let byName = new Map();
  let modKey = ''; let mod = null;
  const profile = () => profiles.find((p) => p.id === activeId);

  function universe() {
    const p = profile(); const key = `${repo.revision}|${p.dataBasis}`;
    if (key !== uniKey) {
      uni = repo.universe(p.dataBasis); uniKey = key; modKey = '';
      byName = new Map(uni.players.map((x) => [x.name, x]));
    }
    return uni;
  }
  function model() {
    const u = universe(); const p = profile();
    const key = [uniKey, p.minGP, p.refMode, JSON.stringify(p.weights), p.selected.slice().sort().join('|')].join('::');
    if (key !== modKey) {
      mod = buildModel(u.players, { weights: p.weights, minGP: p.minGP, refMode: p.refMode, selected: p.selected }); modKey = key;
    }
    return mod;
  }
  const playerByName = (name) => { universe(); return byName.get(name) || null; };
  const rosterPlayers = (names) => names.map((n) => playerByName(n)).filter(Boolean);
  const weeklyCtx = () => { const p = profile(); return { week: p.week, overrides: p.overrides, teamOverrides: p.teamOverrides, schedule: SCHEDULE }; };
  const effectiveTeam = (p) => profile().teamOverrides[p.name] || p.team;

  // ---------- mutation ----------
  function commit(topics, fn) {
    const i = profiles.findIndex((p) => p.id === activeId);
    const draft = structuredClone(profiles[i]);
    fn(draft);
    profiles = profiles.slice(); profiles[i] = normalizeProfile({ ...draft, schemaVersion: PROFILE_SCHEMA });
    persist(); emit(topics);
  }
  const uniq = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);

  const app = {
    storage, repo, boot, SCHEDULE, WEEKS, TEAMS,
    get profiles() { return profiles; }, get activeId() { return activeId; }, get profile() { return profile(); },
    get settings() { return settings; },
    universe, model, playerByName, rosterPlayers, weeklyCtx, effectiveTeam,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit, commit, persist,
    h2hSet: () => new Set(profile().h2hCategories),

    setSetting(key, value) { settings = { ...settings, [key]: value }; storage.setJSON('settings', settings); emit(['ui']); },

    // --- leagues ---
    addLeague(name) {
      const nm = String(name || '').trim().slice(0, 80); if (!nm) return false;
      const p = makeProfile(nm); p.week = profile().week; profiles = [...profiles, p]; activeId = p.id; persist(); emit(TOPICS); return true;
    },
    copyLeague(name) {
      const nm = String(name || '').trim().slice(0, 80); if (!nm) return false;
      const p = normalizeProfile({ ...structuredClone(profile()), id: newId(), name: nm }); profiles = [...profiles, p]; activeId = p.id; persist(); emit(TOPICS); return true;
    },
    renameLeague(name) {
      const nm = String(name || '').trim().slice(0, 80); if (!nm || nm === profile().name) return false;
      commit(['league'], (d) => { d.name = nm; }); return true;
    },
    deleteLeague() {
      if (profiles.length <= 1) return false;
      profiles = profiles.filter((p) => p.id !== activeId); activeId = profiles[0].id; persist(); emit(TOPICS); return true;
    },
    switchLeague(id) { if (id === activeId || !profiles.some((p) => p.id === id)) return false; activeId = id; persist(); emit(TOPICS); return true; },
    exportLeague: () => exportProfile(profile()),
    exportEverything: () => exportAll(profiles, activeId),
    importConfig(json) {
      const r = parseImport(json); if (r.error) return { ok: false, error: r.error };
      storage.setJSON('backup.before-import', { at: now(), profiles });
      profiles = [...profiles, ...r.profiles]; activeId = r.profiles[0].id; persist(); emit(TOPICS);
      return { ok: true, count: r.profiles.length, warnings: r.warnings };
    },

    // --- roster (my team / opponent) ---
    addPlayer(name) { if (profile().selected.includes(name)) return; commit(['roster', 'what', 'marks'], (d) => { d.selected = uniq(d.selected, name); d.oppSelected = d.oppSelected.filter((n) => n !== name); d.whatIn = d.whatIn.filter((n) => n !== name); }); },
    removePlayer(name) { commit(['roster', 'what'], (d) => { d.selected = d.selected.filter((n) => n !== name); d.whatOut = d.whatOut.filter((n) => n !== name); }); },
    clearRoster() { commit(['roster', 'what', 'games', 'marks'], (d) => { d.selected = []; d.overrides = {}; d.draftUnavailable = []; d.whatIn = []; d.whatOut = []; }); },
    addOpp(name) { if (profile().oppSelected.includes(name)) return; commit(['opp'], (d) => { d.oppSelected = uniq(d.oppSelected, name); d.selected = d.selected.filter((n) => n !== name); }); },
    removeOpp(name) { commit(['opp'], (d) => { d.oppSelected = d.oppSelected.filter((n) => n !== name); }); },
    clearOpp() { commit(['opp'], (d) => { d.oppSelected = []; }); },
    setGames(name, g) { commit(['games'], (d) => { if (g === null || g === undefined) delete d.overrides[name]; else d.overrides[name] = Math.max(0, Math.min(RULES.maxGames, Math.round(Number(g) || 0))); }); },
    setTeam(name, team) { commit(['teams', 'games'], (d) => { if (!team || !TEAMS[team]) delete d.teamOverrides[name]; else d.teamOverrides[name] = team; }); },

    // --- model settings ---
    setWeight(cat, v) { commit(['weights'], (d) => { d.weights[cat] = Math.max(0, Number(v) || 0); }); },
    resetWeights() { commit(['weights'], (d) => { d.weights = makeProfile().weights; }); },
    setMinGP(v) { commit(['settings'], (d) => { d.minGP = clampMinGp(v); }); },
    setRefMode(v) { commit(['settings'], (d) => { d.refMode = v === 'league' ? 'league' : 'top200'; }); },
    setBasis(v) { commit(['settings', 'data'], (d) => { d.dataBasis = v; }); },
    setWeek(w) { commit(['week'], (d) => { d.week = Math.max(0, Math.min(WEEKS.length - 1, Number(w) || 0)); }); },
    toggleH2H(cat, on) { commit(['h2h'], (d) => { const s = new Set(d.h2hCategories); on ? s.add(cat) : s.delete(cat); d.h2hCategories = [...s]; }); },

    // --- draft board ---
    setCandSort(k) { commit(['candui'], (d) => { d.candSort = k; }); },
    setAvailableOnly(v) { commit(['candui'], (d) => { d.candAvailableOnly = !!v; }); },
    toggleUnavailable(name) { commit(['marks'], (d) => { d.draftUnavailable = d.draftUnavailable.includes(name) ? d.draftUnavailable.filter((n) => n !== name) : [...d.draftUnavailable, name]; }); },
    clearUnavailable() { commit(['marks'], (d) => { d.draftUnavailable = []; }); },

    // --- what-if ---
    toggleWhatIn(name) {
      const p = profile(); const has = p.whatIn.includes(name);
      if (!has && p.whatIn.length >= WHATIF_MAX) return { ok: false, error: `What-if 最多同時加入 ${WHATIF_MAX} 位球員。` };
      commit(['what'], (d) => { if (has) d.whatIn = d.whatIn.filter((n) => n !== name); else { d.whatIn = [...d.whatIn, name]; d.whatOut = d.whatOut.filter((n) => n !== name); } });
      return { ok: true };
    },
    toggleWhatOut(name) {
      const p = profile(); const has = p.whatOut.includes(name);
      if (!has && p.whatOut.length >= WHATIF_MAX) return { ok: false, error: `What-if 最多同時移除 ${WHATIF_MAX} 位球員。` };
      commit(['what'], (d) => { if (has) d.whatOut = d.whatOut.filter((n) => n !== name); else { d.whatOut = [...d.whatOut, name]; d.whatIn = d.whatIn.filter((n) => n !== name); } });
      return { ok: true };
    },
    clearWhatIf() { commit(['what'], (d) => { d.whatIn = []; d.whatOut = []; }); },

    // --- my draft order (Yahoo tab) ---
    toggleMyRank(name) { commit(['myrank'], (d) => { d.myRank = d.myRank.includes(name) ? d.myRank.filter((n) => n !== name) : [...d.myRank, name]; }); },
    moveMyRank(from, to) {
      const n = profile().myRank.length; if (from < 0 || to < 0 || from >= n || to >= n || from === to) return;
      commit(['myrank'], (d) => { const [it] = d.myRank.splice(from, 1); d.myRank.splice(to, 0, it); });
    },
    /** Commit a complete new order once (used when a drag ends). No-op when nothing changed. */
    setMyRankOrder(order) {
      const cur = profile().myRank; const same = order.length === cur.length && order.every((n, i) => n === cur[i]);
      if (same || order.length !== cur.length || new Set(order).size !== order.length || !order.every((n) => cur.includes(n))) return false;
      commit(['myrank'], (d) => { d.myRank = [...order]; }); return true;
    },
    clearMyRank() { commit(['myrank'], (d) => { d.myRank = []; }); },
    /**
     * Copy a league's "my draft order" to other leagues.
     * mode 'replace': target order becomes the source order.  mode 'merge': keep the target's order, append source players it lacks.
     * @returns {{ok:boolean,error?:string,results?:{id:string,name:string,before:number,after:number,added:number}[]}}
     */
    copyRank({ fromId, toIds, mode = 'merge' }) {
      const src = profiles.find((p) => p.id === fromId);
      if (!src) return { ok: false, error: '找不到來源聯盟。' };
      if (!src.myRank.length) return { ok: false, error: `「${src.name}」還沒有選人順位可以複製。` };
      if (mode !== 'replace' && mode !== 'merge') return { ok: false, error: '未知的複製方式。' };
      const targets = [...new Set(toIds)].filter((id) => id !== fromId && profiles.some((p) => p.id === id));
      if (!targets.length) return { ok: false, error: '請選擇至少一個目標聯盟。' };
      storage.setJSON('backup.before-copy-rank', { at: now(), profiles });
      const results = [];
      profiles = profiles.map((p) => {
        if (!targets.includes(p.id)) return p;
        const before = p.myRank.length;
        const next = mode === 'replace' ? [...src.myRank] : [...p.myRank, ...src.myRank.filter((n) => !p.myRank.includes(n))];
        results.push({ id: p.id, name: p.name, before, after: next.length, added: mode === 'replace' ? next.length : next.length - before });
        return normalizeProfile({ ...p, myRank: next });
      });
      persist(); emit(['myrank']);
      return { ok: true, results };
    },
  };
  load();
  repo.subscribe(() => emit(['data']));
  void normalizeName;
  return app;
}
