// ④ Player database: searchable / sortable full player pool with a detail panel (stats, Z-profile, data provenance).
import { $, esc, on, setHtml, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { STAT_COLUMNS, DATA_BASES, SCORING_CATS, CATS } from '../engine/schema.js';
import { baseFit, teamFit, fitIndex, fitTone, hasFit, cellTone } from '../engine/model.js';
import { projectedGames } from '../engine/weekly.js';
import { buildSearchIndex, searchPlayers } from '../engine/search.js';
import { fmtStat, fmt1 } from '../ui/format.js';
import { emptyState, badge, rookieBadge, statusBadge } from '../components/badges.js';
import { statCells, statHeads, rowClass, playerCell } from '../components/statcells.js';
import { avatarHtml, hydrateAvatars } from '../components/avatar.js';
import { TEAMS, TEAM_CODES } from '../data/static/teams.js';
import { isNum, normalizeName } from '../engine/util.js';
import { toast } from '../components/toast.js';

const SORTS = { teamfit: 'Team Fit', basefit: 'Base Fit', yahoo: 'Yahoo Rank', gp: 'GP', name: '姓名', ...Object.fromEntries(STAT_COLUMNS.map((c) => [c.key, c.label])) };

export function createPlayersView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-players');
  root.innerHTML = `
<div class="panel section" id="pDetailPanel"><div class="panel-b" id="pDetail" data-testid="player-detail"></div></div>
<div class="panel section"><div class="panel-h"><h3>球員資料 <span class="sub" id="pCount"></span></h3></div>
 <div class="toolbar"><div class="grow"><input class="inp" id="pSearch" data-testid="player-search" placeholder="搜尋球員 / 球隊（不分大小寫與重音）" autocomplete="off"></div>
  <select class="inp" id="pSort" style="width:auto" aria-label="排序" data-testid="player-sort"></select>
  <label class="check"><input type="checkbox" id="pHas" data-testid="player-has-stats"> 只顯示有統計的球員</label></div>
 <div id="pGrid" data-testid="player-grid"></div></div>`;
  let detail = null; let q = ''; let sortKey = 'teamfit'; let limit = 50; let idx = null; let idxKey = '';
  const index = () => { const k = `${app.repo.revision}|${app.profile.dataBasis}`; if (k !== idxKey) { idx = buildSearchIndex(app.universe().players); idxKey = k; } return idx; };
  $('#pSort').innerHTML = Object.entries(SORTS).map(([k, l]) => `<option value="${k}">排序：${esc(l)}</option>`).join('');

  const zColor = (z) => (z >= 0.35 ? 'var(--good)' : z <= -0.35 ? 'var(--bad)' : 'var(--dim)');

  function renderDetail() {
    const el = $('#pDetail');
    const p = detail ? app.playerByName(detail) : null;
    if (!p) { el.innerHTML = emptyState('點選球員查看詳細資料', '在下方搜尋或點名字，這裡會顯示完整數據、各分類 Z 分數與資料來源。', 'players'); return; }
    const m = app.model(); const pr = app.profile; const wctx = app.weeklyCtx();
    const tm = app.effectiveTeam(p); const g = projectedGames(p, wctx);
    const role = pr.selected.includes(p.name) ? '我的球員' : pr.oppSelected.includes(p.name) ? '對手球員' : '候選球員';
    const ok = hasFit(p, m);
    const metrics = STAT_COLUMNS.map((c) => { const t = cellTone(m, p, c.cat); return `<div class="dm ${t === 'good' ? 'good' : t === 'bad' ? 'bad' : ''}"><span>${esc(c.label)}</span><b>${fmtStat(c.kind, c.key, p[c.key])}</b></div>`; }).join('');
    const zrows = ok ? m.cats.map((k) => { const z = m.zs[k]?.get(p.name); if (!isNum(z)) return `<div class="zrow"><span>${k}</span><span class="dim">無資料</span><span></span></div>`; const w = Math.abs(z) / 2.5 * 50; return `<div class="zrow"><span>${k}</span><div class="zbar"><i style="${z >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:${zColor(z)}"></i></div><b style="color:${zColor(z)};text-align:right">${z >= 0 ? '+' : ''}${z.toFixed(2)}</b></div>`; }).join('') : '<p class="muted">參考池資料不足或沒有統計，無法計算 Z 分數。</p>';
    const last = app.repo.getDataset('last')?.rows.find((r) => r.id === p.id);
    let prov = `<dl class="kv"><dt>資料基準</dt><dd>${esc(p.src?.source || '—')}</dd><dt>球季 / 期間</dt><dd>${esc(p.src?.season || '—')} · ${esc({ full: '完整球季', 'to-date': '開季至今', last10: '近 10 場', projection: '模型估算' }[p.src?.period] || '—')}</dd><dt>出賽 GP</dt><dd>${isNum(p.gp) ? p.gp : '—'}</dd><dt>2026-27 球隊</dt><dd>${esc(TEAMS[tm] || tm)}${p.baselineTeam && p.baselineTeam !== tm ? ` <span class="badge b-amber">換隊</span> <span class="dim">上季 ${esc(p.baselineTeam)}</span>` : ''}</dd><dt>本週場次</dt><dd>${g.games}${g.source === 'assumed' ? ' <span class="badge b-amber">賽程未知 · 暫估</span>' : g.source === 'override' ? ' <span class="badge b-blue">手動調整</span>' : ''}</dd><dt>Yahoo Rank</dt><dd>${p.yahooRank ? '#' + p.yahooRank : '未在 Yahoo Top 200'}</dd></dl>`;
    let note = '';
    if (p.status === 'historical') note = `<div class="banner warn">${icon('alert', 16)}<div>使用 ${esc(p.statsSeason)} 歷史參考數據（${DATA_BASES.last.season} GP = 0）。這不是本季實績，也不會進入參考池。</div></div>`;
    else if (p.status === 'projection') note = `<div class="banner info">${icon('info', 16)}<div>新秀 NBA 數據是 L7N Rookie Translation v0.1 的模型估算（信心：${esc(p.projectionConfidence || '—')}），不是官方預測，取得 NBA 實績後會被實績取代。</div></div>`;
    else if (p.status === 'no-current') note = `<div class="banner warn">${icon('alert', 16)}<div>目前的資料基準（${esc(DATA_BASES[app.universe().used].label)}）沒有這位球員的統計，不會借用其他球季的數字。${last ? '下方顯示 2025-26 完整球季作為參考。' : ''}</div></div>`;
    else if (p.status === 'no-data' || p.status === 'no-games') note = `<div class="banner warn">${icon('alert', 16)}<div>${p.status === 'no-games' ? '來源資料中這位球員沒有出賽（GP = 0）。' : '只有球員身分（來自 Yahoo 名單），尚未取得統計資料。'}Fit 與週預測不會把缺值當成 0。</div></div>`;
    const lastRef = last && p.status !== 'ok' && last.status === 'ok' ? `<div class="tiny" style="margin-top:10px">${DATA_BASES.last.label}（參考，GP ${last.gp}）：PTS ${fmt1(last.pts)} · REB ${fmt1(last.reb)} · AST ${fmt1(last.ast)} · STL ${fmt1(last.stl)} · BLK ${fmt1(last.blk)} · 3PM ${fmt1(last.pm3)}</div>` : '';
    el.innerHTML = `<div class="detail-head">${avatarHtml({ ...p, team: tm }, 'xl')}<div style="flex:1;min-width:220px"><h2 data-testid="detail-name">${esc(p.name)} ${rookieBadge(p)}</h2><div class="muted">${esc(TEAMS[tm] || tm)}${p.position ? ' · ' + esc(p.position) : ''}${p.school ? ' · ' + esc(p.school) : ''} ${statusBadge(p)} <span class="badge b-blue">${role}</span></div>
 <div class="row" style="margin-top:10px">${pr.selected.includes(p.name) ? `<button class="btn small danger" data-act="rm">移出我的球隊</button>` : `<button class="btn small primary" data-act="add" data-testid="detail-add">${icon('plus', 14)}加入我的球隊</button>`}${pr.oppSelected.includes(p.name) ? `<button class="btn small" data-act="rm-opp">移出對手</button>` : `<button class="btn small" data-act="add-opp">加入對手</button>`}<button class="btn small" data-act="wi">What-if 模擬</button><button class="btn small" data-act="myrank">${pr.myRank.includes(p.name) ? '移出我的順位' : '加入我的順位'}</button>
 <select class="inp" style="width:170px;height:28px" data-act-change="team" aria-label="手動覆寫球隊" title="手動覆寫所屬球隊（影響賽程）"><option value="">球隊：預設</option>${TEAM_CODES.map((t) => `<option value="${t}" ${pr.teamOverrides[p.name] === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
 <div style="display:flex;gap:10px">${ok ? `<div class="metric"><b>${fitIndex(teamFit(p, m)).toFixed(0)}</b><span>Team Fit</span></div><div class="metric"><b>${fitIndex(baseFit(p, m)).toFixed(0)}</b><span>Base Fit</span></div>` : '<div class="metric"><b>—</b><span>Fit 不可用</span></div>'}</div></div>
 ${note}<div class="dgrid">${metrics}</div>${lastRef}
 <div class="grid2" style="margin-top:16px;grid-template-columns:minmax(260px,1fr) minmax(260px,1fr)"><div><div class="tiny" style="margin-bottom:6px">各分類 Z 分數（${DATA_BASES[app.universe().used === 'seed' ? 'last' : app.universe().used].short}，±2.5 截斷；TOV 已反向）</div>${zrows}</div><div><div class="tiny" style="margin-bottom:6px">資料來源與狀態</div>${prov}</div></div>`;
    hydrateAvatars(el, headshots);
  }

  let gridSig = null;
  function renderGrid() {
    const m = app.model(); const pr = app.profile; const u = app.universe();
    const onlyStats = $('#pHas').checked;
    const sig = [app.settings.photos !== false, app.repo.revision, pr.dataBasis, pr.minGP, pr.refMode, JSON.stringify(pr.weights), pr.selected.join('|'), pr.week, JSON.stringify(pr.overrides), JSON.stringify(pr.teamOverrides), q, sortKey, limit, onlyStats].join('#');
    if (sig === gridSig) return; gridSig = sig;
    let list = q.trim() ? searchPlayers(index(), q, { limit: 2000 }) : u.players.slice();
    if (onlyStats) list = list.filter((x) => isNum(x.pts));
    const rows = list.map((x) => ({ p: x, tf: hasFit(x, m) ? fitIndex(teamFit(x, m)) : null, bf: hasFit(x, m) ? fitIndex(baseFit(x, m)) : null }));
    const val = (r) => { switch (sortKey) { case 'teamfit': return r.tf; case 'basefit': return r.bf; case 'yahoo': return r.p.yahooRank ?? 9999; case 'gp': return r.p.gp; case 'name': return r.p.name; default: return r.p[sortKey]; } };
    if (!(q.trim() && sortKey === 'teamfit')) rows.sort((a, b) => {
      const x = val(a); const y = val(b);
      if (sortKey === 'name') return String(x).localeCompare(String(y));
      if (sortKey === 'yahoo') return x - y;
      if (sortKey === 'tov') return (isNum(x) ? x : Infinity) - (isNum(y) ? y : Infinity);
      return (isNum(y) ? y : -Infinity) - (isNum(x) ? x : -Infinity);
    });
    $('#pCount').textContent = `${rows.length} / ${u.players.length} 人${u.counts.withStats < u.players.length ? `（其中 ${u.counts.withStats} 人有統計）` : ''}`;
    const box = $('#pGrid');
    if (!rows.length) { box.innerHTML = emptyState('找不到符合的球員', '這不代表球員不存在：可能是資料中尚未收錄或名字拼法不同。', 'players'); return; }
    const shown = rows.slice(0, limit);
    const body = shown.map((r) => { const x = r.p; const g = projectedGames(x, app.weeklyCtx());
      return `<tr class="${rowClass(x)}" data-name="${esc(x.name)}"><td class="l stick s0 s-edge">${playerCell(x, { team: app.effectiveTeam(x) })}</td><td class="c">${x.yahooRank ? `<span class="rank-pill">${x.yahooRank}</span>` : '—'}</td><td class="c">${isNum(x.gp) && x.gp ? x.gp : '—'}</td><td class="c"><span class="fit ${r.tf === null ? 'na' : fitTone(r.tf)}">${r.tf === null ? '—' : r.tf.toFixed(0)}</span></td>${statCells(x, m)}<td class="c">${g.games}${g.source === 'assumed' ? '?' : ''}</td></tr>`; }).join('');
    const more = rows.length > shown.length ? `<div class="more-row"><button class="btn" data-act="more">顯示更多（${shown.length} / ${rows.length}）</button></div>` : '';
    setHtml(box.firstElementChild?.classList?.contains('tbl-wrap') ? box.firstElementChild : (box.innerHTML = '<div class="tbl-wrap tall"></div>', box.firstElementChild), `<table class="tbl"><thead><tr><th class="l stick s0 s-edge">Player</th><th class="c">Yahoo</th><th class="c">GP</th><th class="c">Team Fit</th>${statHeads()}<th class="c">Wk 場次</th></tr></thead><tbody>${body}</tbody></table>${more}`);
    hydrateAvatars(box, headshots); void pr;
  }

  const onSearch = debounce(() => { limit = 50; gridSig = null; renderGrid(); }, 80);
  $('#pSearch').addEventListener('input', (e) => { q = e.target.value; onSearch(); });
  $('#pSort').addEventListener('change', (e) => { sortKey = e.target.value; renderGrid(); });
  $('#pHas').addEventListener('change', () => { limit = 50; renderGrid(); });
  on(root, 'click', '[data-detail]', (e, t) => { detail = t.dataset.detail; renderDetail(); $('#pDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act; const n = detail;
    if (a === 'more') { limit += 60; renderGrid(); }
    else if (a === 'add') { app.addPlayer(n); toast(`已加入我的球隊：${n}`, { level: 'ok' }); }
    else if (a === 'rm') app.removePlayer(n);
    else if (a === 'add-opp') { app.addOpp(n); toast(`已加入對手：${n}`, { level: 'ok' }); }
    else if (a === 'rm-opp') app.removeOpp(n);
    else if (a === 'wi') { const r = app.toggleWhatIn(n); toast(r.ok ? `What-if：${app.profile.whatIn.includes(n) ? '加入' : '取消'} ${n}` : r.error, { level: r.ok ? 'info' : 'warn' }); }
    else if (a === 'myrank') app.toggleMyRank(n);
  });
  on(root, 'change', '[data-act-change="team"]', (e, t) => app.setTeam(detail, t.value));
  void normalizeName; void SCORING_CATS; void CATS;

  return {
    id: 'players', topics: ['roster', 'opp', 'weights', 'settings', 'week', 'games', 'teams', 'myrank', 'what', 'league'],
    showDetail(name) { detail = name; $('#pSearch').value = ''; q = ''; renderDetail(); },
    render() { $('#pSort').value = sortKey; renderDetail(); renderGrid(); },
  };
}
