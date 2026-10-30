// Entry point: wires storage -> repository -> app controller -> views. Rendering is dirty-flag driven:
// a mutation marks only the views that depend on its topics; only the visible view re-renders (others lazily on show).
import { createStorage } from './state/storage.js';
import { createRepository } from './data/repository.js';
import { createApp } from './state/app.js';
import { createHeadshots } from './data/headshots.js';
import { teamTotals, projectedGames, h2hRows, h2hRecord } from './engine/weekly.js';
import { createQuickAdd } from './components/quickadd.js';
import { initPreview } from './components/preview.js';
import { toast } from './components/toast.js';
import { createDrawer } from './features/drawer.js';
import { createDraftView } from './features/draft.js';
import { createWeeklyView } from './features/weekly.js';
import { createScheduleView } from './features/schedule.js';
import { createPlayersView } from './features/players.js';
import { createRookiesView } from './features/rookies.js';
import { createYahooView } from './features/yahoo.js';
import { createHistoryView } from './features/history.js';
import { $, $$, esc, on, raf } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { DATA_BASES } from './engine/schema.js';
import { pipelineFreshness } from './data/repository.js';
import { VERSION, PRODUCT } from './version.js';

const TABS = [
  { id: 'draft', label: '選人 / 我的球隊', short: '選人', icon: 'draft' },
  { id: 'weekly', label: 'Weekly H2H', short: '週對戰', icon: 'weekly' },
  { id: 'schedule', label: 'NBA 賽程', short: '賽程', icon: 'schedule' },
  { id: 'players', label: '球員資料', short: '球員', icon: 'players' },
  { id: 'rookies', label: 'Rookie Hub', short: '新秀', icon: 'rookies' },
  { id: 'yahoo', label: 'Yahoo 排名', short: 'Yahoo', icon: 'yahoo' },
  { id: 'history', label: '勝負歷史', short: '歷史', icon: 'star' },
];

const storage = createStorage();
const repo = createRepository({ storage }).init();
const app = createApp({ storage, repo });
const headshots = createHeadshots({ enabled: app.settings.photos !== false });
globalThis.__weeklyEngine = { teamTotals, projectedGames, h2hRows, h2hRecord };
initPreview();
document.body.classList.toggle('reduce-motion', !!app.settings.reduceMotion);

const ctx = { app, repo, headshots, TABS, go, showPlayer: null, quickAdd: null, drawer: null };
ctx.quickAdd = createQuickAdd(app, headshots);
ctx.drawer = createDrawer(ctx);

const views = {
  draft: createDraftView(ctx), weekly: createWeeklyView(ctx), schedule: createScheduleView(ctx),
  players: createPlayersView(ctx), rookies: createRookiesView(ctx), yahoo: createYahooView(ctx), history: createHistoryView(ctx),
};
ctx.showPlayer = (name) => { views.players.showDetail(name); go('players'); };

let active = null; const dirty = new Set(Object.keys(views)); let headerDirty = true; let scheduled = false;

// ---------- chrome ----------
function renderNav() {
  const btn = (t) => `<button class="nav-btn ${t.id === active ? 'active' : ''}" data-tab="${t.id}" data-testid="tab-${t.id}" aria-label="${esc(t.label)}" ${t.id === active ? 'aria-current="page"' : ''}>${icon(t.icon, 22)}<span>${esc(t.short)}</span></button>`;
  $('#rail').innerHTML = TABS.map(btn).join('');
  $('#bottomnav').innerHTML = TABS.map(btn).join('');
}
function renderHeader() {
  const p = app.profile; const u = app.universe(); const s = repo.sync;
  const real = u.used !== 'seed' && u.used === p.dataBasis;
  const fr = pipelineFreshness(repo.pipelineMeta);
  const dot = s.state === 'syncing' ? 'sync' : u.used === 'seed' ? 'err' : fr?.level === 'stale' ? 'err' : (fr?.level === 'warn' || !real) ? 'warn' : 'ok';
  const label = u.used === 'seed' ? '種子資料' : DATA_BASES[u.used].short;
  $('#top').innerHTML = `<div class="brand"><img src="assets/l7n-logo.png" alt="L7N" width="34" height="34"><div class="brand-t"><b>${PRODUCT}</b><small>v${VERSION} · 2026-27 Season</small></div></div><div class="top-sp"></div>
<button class="chip" data-act="search" data-testid="open-search" aria-label="搜尋球員">${icon('players', 16)}<span class="hide-m">搜尋球員</span><span class="kbd hide-m">/</span></button>
<button class="chip chip-league" data-act="drawer" data-testid="league-chip" title="目前聯盟（點擊管理）">${icon('league', 16)}<span>${esc(p.name)}</span></button>
<button class="chip chip-data" data-act="drawer" data-testid="data-chip" title="${esc((u.meta?.sourceLabel || '') + (fr ? ' · ' + fr.text : ''))}"><i class="dot ${dot}"></i><span class="lbl">${esc(label)} · </span><span>${u.counts.withStats} 人</span></button>
<button class="icon-btn" data-act="drawer" data-testid="open-drawer" aria-label="控制中心">${icon('gear', 20)}</button>
<button class="icon-btn" data-act="help" aria-label="使用說明" data-testid="open-help">${icon('help', 20)}</button>`;
  headerDirty = false;
}
function renderBanner() {
  const u = app.universe(); const m = app.model(); const rows = [];
  for (const n of u.notes) rows.push({ level: n.level === 'error' ? 'error' : 'warn', text: n.text, code: n.code });
  if (!m.status.ok && !u.notes.some((n) => n.code === 'seed-only')) rows.push({ level: 'error', text: m.status.reason, code: 'pool' });
  if (repo.sync.state === 'failed') rows.push({ level: 'info', text: repo.sync.message, code: 'sync' });
  $('#banner').innerHTML = rows.map((r) => `<div class="banner ${r.level}" data-testid="banner-${r.code}">${icon(r.level === 'error' ? 'alert' : 'info', 18)}<div>${esc(r.text)}</div>${r.code !== 'sync' ? `<button class="btn small" data-act="drawer">資料中心</button>` : ''}</div>`).join('');
}

// ---------- routing & render ----------
function go(tab, { push = true } = {}) {
  if (!views[tab]) tab = 'draft';
  const changed = tab !== active; active = tab;
  for (const t of TABS) { const el = $(`#view-${t.id}`); if (el) el.hidden = t.id !== tab; }
  renderNav();
  if (push && changed) { try { history.replaceState(null, '', `#/${tab}`); } catch { /* file:// restrictions */ } }
  app.setSetting('tab', tab);
  schedule(); window.scrollTo?.({ top: 0 });
}
function safeRender(id) {
  try { views[id].render(); }
  catch (e) { console.error(`[L7N] ${id} render failed`, e); $(`#view-${id}`).innerHTML = `<div class="banner error"><div><b>這個頁面載入時發生錯誤</b>${esc(e.message)}。你的資料沒有被修改，請重新整理；若持續發生請回報。</div></div>`; }
}
function flush() {
  scheduled = false;
  if (headerDirty) { renderHeader(); renderBanner(); }
  if (active && dirty.has(active)) { dirty.delete(active); safeRender(active); }
}
function schedule() { if (!scheduled) { scheduled = true; raf(flush); } }

app.subscribe((topics) => {
  for (const [id, v] of Object.entries(views)) if (topics.has('data') || v.topics.some((t) => topics.has(t))) dirty.add(id);
  if (['league', 'data', 'settings', 'weights', 'roster'].some((t) => topics.has(t))) headerDirty = true;
  schedule();
});
repo.subscribe(() => { headerDirty = true; schedule(); });

// ---------- global events ----------
on(document, 'click', '[data-tab]', (e, t) => go(t.dataset.tab));
on(document, 'click', '[data-act="drawer"]', () => ctx.drawer.open());
on(document, 'click', '[data-act="search"]', () => ctx.quickAdd.open(active === 'weekly' ? 'opp' : 'me'));
on(document, 'click', '[data-act="help"]', () => showHelp());
$('#fab').innerHTML = icon('plus', 26);
$('#fab').addEventListener('click', () => ctx.quickAdd.open(active === 'weekly' ? 'opp' : 'me'));
document.addEventListener('keydown', (e) => {
  const tag = (e.target?.tagName || '').toLowerCase(); const typing = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable;
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); ctx.quickAdd.open(active === 'weekly' ? 'opp' : 'me'); }
  else if (e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); go(TABS[Number(e.key) - 1].id); }
});
window.addEventListener('hashchange', () => { const m = location.hash.match(/^#\/(\w+)/); if (m && views[m[1]] && m[1] !== active) go(m[1], { push: false }); });

function showHelp() {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" style="width:min(860px,100%);max-height:86vh;overflow:auto" role="dialog" aria-modal="true" aria-label="使用說明"><div class="row sp"><h3 style="margin:0">${PRODUCT} 使用說明</h3><button class="icon-btn" data-x aria-label="關閉">${icon('close', 18)}</button></div>
<p class="muted">用數據取代猜測：選人 → 補強 → 每週對戰，都在同一個地方。</p><div class="help-grid">
<div class="help-item"><h4>① 選人 / 我的球隊</h4><p>看球隊 13 個分類的強弱（50 = 參考池中性）、挑 Candidate Fit 候選人、用 What-if 模擬加人／移除的影響，也能直接加入球隊。</p></div>
<div class="help-item"><h4>② Weekly H2H</h4><p>球員 per-game × 該週預測場次。FG% / FT% / 3P% 用總命中 ÷ 總出手；A/T 用總 AST ÷ 總 TOV；DD 為 DD/G × 場次（預估）。可手動調整每人場次。</p></div>
<div class="help-item"><h4>③ NBA 賽程</h4><p>每週 30 隊場次熱度圖，紫色為 4+ 場高密度週；標出你球員所在球隊，並可手動覆寫換隊。</p></div>
<div class="help-item"><h4>④ 球員資料</h4><p>整個球員池可排序、搜尋；點球員看詳細資料與各分類 Z 分數。DD 為整季總數；TD 只顯示不計分。</p></div>
<div class="help-item"><h4>⑤ Rookie Hub</h4><p>NCAA 原始數據與 NBA Projection 分開顯示；Projection 是 L7N 模型估算，不是官方預測，取得 NBA 實績後以實績為準。</p></div>
<div class="help-item"><h4>⑥ Yahoo 排名</h4><p>Yahoo 預選順位只是外部市場參考，不改變 L7N 引擎。可建立「我的選人順位」，拖曳或用 ↑↓ 調整，每個聯盟各自保存。</p></div></div>
<p class="tiny" style="margin-top:12px">快速鍵：<span class="kbd">/</span> 或 <span class="kbd">Ctrl/⌘ K</span> 搜尋球員　<span class="kbd">Alt 1–6</span> 切換頁籤　<span class="kbd">Esc</span> 關閉視窗。50 分是中性參考值；TOV 是反向分類，失誤越低越好。</p></div>`;
  document.body.appendChild(wrap); requestAnimationFrame(() => wrap.classList.add('in'));
  const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 160); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  wrap.querySelector('[data-x]').focus();
}

// ---------- boot ----------
$('#footer').textContent = `${PRODUCT} v${VERSION}｜個人研究用途；資料更新以外部來源與最後更新時間為準。`;
app.boot.notes.forEach((n) => toast(n.text, { level: n.level === 'error' ? 'error' : 'info', ms: 5000 }));
if (app.boot.migrated) toast(app.boot.migrated, { level: 'ok', ms: 6000 });
const startTab = (location.hash.match(/^#\/(\w+)/) || [])[1] || app.settings.tab;
go(views[startTab] ? startTab : 'draft', { push: false });
flush();
// Background sync (never blocks the UI). Pipeline URL configured -> L7N pipeline first; the legacy remote CSV is only used while no
// pipeline data has ever been loaded. Failures keep the last validated data.
const legacySync = () => { const d = repo.getDataset('last'); if (!d || (d.meta.source !== 'import' && d.meta.source !== 'pipeline')) return repo.syncRemote('last'); return Promise.resolve(); };
const pipelineUrl = app.settings.dataUrl;
(pipelineUrl ? repo.syncPipeline(pipelineUrl).then((r) => (r.ok || repo.hasPipelineData() ? null : legacySync())) : legacySync()).then(() => { headerDirty = true; schedule(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__L7N = { app, repo, headshots, views, go }; // handle for tests / debugging
void $$;
