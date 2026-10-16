// ⑤ Rookie Hub: 2026 draft class. NCAA raw numbers and the NBA projection are separate; the projection is a labeled model estimate.
import { $, esc, on, setHtml, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ROOKIE_DB, ROOKIE_SOURCE_INFO, ROOKIE_MODEL_VERSION } from '../data/static/rookies.js';
import { rookieProjection } from '../engine/rookie.js';
import { TEAMS } from '../data/static/teams.js';
import { normalizeName } from '../engine/util.js';
import { fmt1, pct } from '../ui/format.js';
import { badge, emptyState } from '../components/badges.js';
import { avatarHtml, hydrateAvatars } from '../components/avatar.js';
import { toast } from '../components/toast.js';

const FILTERS = { all: '全部 60 位', lottery: 'Lottery（前 14 順位）', verified: '已驗證 NCAA 資料', model: '有模型 Projection（前 30 順位）' };

export function createRookiesView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-rookies');
  root.innerHTML = `
<div class="panel section"><div class="panel-b" id="rDetail" data-testid="rookie-detail"></div></div>
<div class="panel section"><div class="panel-h"><h3>2026 Rookie Hub <span class="sub">NCAA 原始資料與 NBA Projection 分開；Projection 不是 NCAA 的 Z-score，也不是官方預測</span></h3><span class="sub" id="rCount"></span></div>
 <div class="toolbar"><div class="grow"><input class="inp" id="rSearch" data-testid="rookie-search" placeholder="搜尋新秀 / 學校 / 球隊" autocomplete="off"></div>
 <select class="inp" id="rFilter" style="width:auto" data-testid="rookie-filter" aria-label="篩選">${Object.entries(FILTERS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
 <div class="tbl-wrap tall" id="rGrid" data-testid="rookie-grid"></div>
 <p class="sec-note">資料來源：${esc(ROOKIE_SOURCE_INFO.draft)}；NCAA：${esc(ROOKIE_SOURCE_INFO.ncaa)}。NBA Projection：${esc(ROOKIE_MODEL_VERSION)}（賽季前模型，非專家共識預測）。NCAA 數字只在已驗證的項目顯示，其餘為「僅身分資料」。取得 NBA 實績後（匯入「本季至今」CSV），實績會取代估算值。</p></div>`;
  let detail = null;
  const searchEl = $('#rSearch'); const filterEl = $('#rFilter');

  const real = (r) => { const p = app.playerByName(r.name); return p && p.status === 'ok' ? p : null; };
  const ncaaLine = (n) => (n && n.pts != null ? `${fmt1(n.pts)} PTS · ${n.reb != null ? fmt1(n.reb) : '—'} REB · ${n.ast != null ? fmt1(n.ast) : '—'} AST` : '—');

  function renderGrid() {
    const q = normalizeName(searchEl.value); const f = filterEl.value;
    const rows = ROOKIE_DB.filter((r) => {
      const txt = normalizeName(`${r.name} ${r.school} ${TEAMS[r.team] || ''} ${r.team}`);
      if (q && !q.split(' ').every((t) => txt.includes(t))) return false;
      if (f === 'lottery' && r.pick > 14) return false;
      if (f === 'verified' && !r.ncaa) return false;
      if (f === 'model' && r.pick > 30) return false;
      return true;
    });
    $('#rCount').textContent = `${rows.length} / ${ROOKIE_DB.length} 位`;
    if (!rows.length) { $('#rGrid').innerHTML = emptyState('沒有符合的新秀', '請調整搜尋或篩選條件。', 'rookies'); return; }
    setHtml($('#rGrid'), `<table class="tbl"><thead><tr><th class="c">Pick</th><th class="l stick s0 s-edge" style="left:46px">Rookie</th><th class="l">2026-27 球隊</th><th class="l">學校</th><th class="l">NCAA（原始）</th><th class="l">NBA Projection（估算）</th><th class="l">狀態</th></tr></thead><tbody>${rows.map((r) => {
      const pr = rookieProjection(r); const rp = real(r);
      return `<tr data-name="${esc(r.name)}" data-testid="rookie-row" style="cursor:pointer"><td class="c stick s0"><span class="rank-pill">#${r.pick}</span></td><td class="l stick s-edge" style="left:46px"><span class="pname">${avatarHtml({ name: r.name, team: r.team }, 'md')}<span><span class="nm">${esc(r.name)}</span><span class="psub">${esc(r.position)}</span></span></span></td><td class="l"><b>${r.team}</b> <span class="muted">${esc(TEAMS[r.team] || '')}</span></td><td class="l">${esc(r.school)}</td><td class="l">${ncaaLine(r.ncaa)}</td>
<td class="l" style="font-style:italic">${fmt1(pr.pts)} PTS · ${fmt1(pr.reb)} REB · ${fmt1(pr.ast)} AST ${badge('估算', 'violet')}</td><td class="l">${badge('ROOKIE', 'violet')} ${r.ncaa ? badge('NCAA verified', 'green') : badge('Metadata only', 'muted')} ${rp ? badge('NBA 實績', 'blue') : ''}</td></tr>`;
    }).join('')}</tbody></table>`);
    hydrateAvatars($('#rGrid'), headshots);
  }

  function renderDetail() {
    const el = $('#rDetail'); const r = ROOKIE_DB.find((x) => x.name === detail);
    if (!r) { el.innerHTML = emptyState('點選新秀查看資料', 'NCAA profile、NBA Projection、資料來源與信心都會顯示在這裡。', 'rookies'); return; }
    const n = r.ncaa || {}; const p = rookieProjection(r); const rp = real(r); const pr = app.profile;
    const mine = pr.selected.includes(r.name);
    const ncaaGrid = r.ncaa ? [['GP', n.gp], ['PTS/G', n.pts], ['REB/G', n.reb], ['AST/G', n.ast], ['STL/G', n.stl], ['BLK/G', n.blk], ['3PM/G', n.pm3]].map(([l, v]) => `<div class="dm"><span>NCAA ${l}</span><b>${v != null ? (l === 'GP' ? v : fmt1(v)) : '—'}</b></div>`).join('') + [['FG%', n.fg], ['FT%', n.ft], ['3P%', n.p3]].map(([l, v]) => `<div class="dm"><span>NCAA ${l}</span><b>${v != null ? pct(v) : '—'}</b></div>`).join('') : `<div class="banner warn" style="grid-column:1/-1;margin:0">${icon('alert', 16)}<div>這位新秀目前只有選秀身分資料，尚無可查證的 NCAA 原始數據；不會編造數字。</div></div>`;
    el.innerHTML = `<div class="detail-head">${avatarHtml({ name: r.name, team: r.team }, 'xl')}<div style="flex:1;min-width:220px"><h2>${esc(r.name)} ${badge('ROOKIE', 'violet')}</h2><div class="muted">Pick #${r.pick} · ${esc(TEAMS[r.team] || r.team)} · ${esc(r.school)} · ${esc(r.position)}</div>
 <div class="row" style="margin-top:10px">${mine ? `<button class="btn small danger" data-act="rm">移出我的球隊</button>` : `<button class="btn small primary" data-act="add" data-testid="rookie-add">${icon('plus', 14)}加入我的球隊</button>`}<button class="btn small" data-act="add-opp">加入對手</button><button class="btn small" data-act="to-player">在球員資料中開啟</button></div></div></div>
 <h4 style="margin:16px 0 4px">NCAA 原始資料 ${r.ncaa ? badge('verified', 'green') : badge('unverified', 'muted')}</h4><div class="dgrid">${ncaaGrid}</div>
 <h4 style="margin:16px 0 4px">NBA 實績 ${rp ? badge('已取得', 'blue') : badge('尚無', 'muted')}</h4>
 ${rp ? `<div class="tiny">來源：${esc(rp.src?.source)}（${esc(rp.src?.season)} · GP ${rp.gp}）。分析引擎使用這份實績，不使用下面的估算。</div><div class="dgrid"><div class="dm"><span>PTS/G</span><b>${fmt1(rp.pts)}</b></div><div class="dm"><span>REB/G</span><b>${fmt1(rp.reb)}</b></div><div class="dm"><span>AST/G</span><b>${fmt1(rp.ast)}</b></div><div class="dm"><span>STL/G</span><b>${fmt1(rp.stl)}</b></div><div class="dm"><span>BLK/G</span><b>${fmt1(rp.blk)}</b></div><div class="dm"><span>3PM/G</span><b>${fmt1(rp.pm3)}</b></div></div>` : '<div class="tiny">目前沒有這位新秀的 NBA 實際數據；匯入「2026-27 開季至今」CSV 後，這裡會顯示實績並取代模型估算。</div>'}
 <h4 style="margin:16px 0 4px">NBA Projection ${badge('估算', 'violet')}</h4><div class="tiny">模型：${esc(ROOKIE_MODEL_VERSION)}｜信心：${esc(p.projectionConfidence)}｜預估出賽 ${p.gp} 場、${p.mpg.toFixed(1)} MPG｜這不是官方預測，也不是 NBA 實績。</div>
 <div class="dgrid" style="font-style:italic">${[['PTS/G', p.pts], ['REB/G', p.reb], ['AST/G', p.ast], ['STL/G', p.stl], ['BLK/G', p.blk], ['3PM/G', p.pm3]].map(([l, v]) => `<div class="dm"><span>${l}</span><b>${fmt1(v)}</b></div>`).join('')}${[['FG%', p.fg], ['FT%', p.ft], ['3P%', p.p3]].map(([l, v]) => `<div class="dm"><span>${l}</span><b>${pct(v)}</b></div>`).join('')}</div>`;
    hydrateAvatars(el, headshots);
  }

  const onSearch = debounce(renderGrid, 80);
  searchEl.addEventListener('input', onSearch); filterEl.addEventListener('change', renderGrid);
  on(root, 'click', '#rGrid tr[data-name]', (e, t) => { detail = t.dataset.name; renderDetail(); $('#rDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act;
    if (a === 'add') { app.addPlayer(detail); toast(`已加入我的球隊：${detail}`, { level: 'ok' }); }
    else if (a === 'rm') app.removePlayer(detail);
    else if (a === 'add-opp') { app.addOpp(detail); toast(`已加入對手：${detail}`, { level: 'ok' }); }
    else if (a === 'to-player') ctx.showPlayer(detail);
  });
  return { id: 'rookies', topics: ['roster', 'opp', 'data', 'settings', 'league'], render() { renderDetail(); renderGrid(); } };
}
