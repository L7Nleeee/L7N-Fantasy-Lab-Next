// ⑥ Yahoo Rankings + "my draft order". Yahoo Rank is an external reference only; it never feeds the L7N engine.
// Dragging reorders rows live (DOM only); the order is saved ONCE on release. ↑/↓ buttons and Alt+Arrow are the non-drag alternatives.
import { $, $$, esc, on, setHtml, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { YAHOO_RANKINGS, YAHOO_META } from '../data/static/yahoo.js';
import { STAT_COLUMNS } from '../engine/schema.js';
import { baseFit, teamFit, fitIndex, fitTone, hasFit } from '../engine/model.js';
import { buildSearchIndex } from '../engine/search.js';
import { normalizeName, isNum } from '../engine/util.js';
import { TEAMS } from '../data/static/teams.js';
import { statCells, statHeads, rowClass, playerCell } from '../components/statcells.js';
import { avatarHtml, hydrateAvatars } from '../components/avatar.js';
import { emptyState, badge } from '../components/badges.js';
import { open as openModal } from '../components/dialog.js';
import { toast } from '../components/toast.js';

const SORTS = { yahoo: 'Yahoo Rank', myrank: '我的順位', fit: 'L7N Fit', pts: 'PTS/G', reb: 'REB/G', ast: 'AST/G', '3p': '3P%', at: 'A/T' };

export function createYahooView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-yahoo');
  root.innerHTML = `
<div class="banner info">${icon('info', 18)}<div><b>Yahoo Rank 是外部市場參考，不會改變 L7N Fantasy Engine。</b>${esc(YAHOO_META.label)}；名單核對日期 ${esc(YAHOO_META.verifiedAt)}（來源：Yahoo 公開預選排名頁，隨 Yahoo 更新可能變動）。<span id="yMeta" data-testid="yahoo-meta"></span></div></div>
<div class="panel section"><div class="panel-h"><h3>⭐ 我的選人順位 <span class="sub">拖曳 ☰ 排序（放開才儲存）· 也可用 ↑↓ · 每個聯盟各自記住</span></h3><div class="row"><button class="btn small" data-act="copy-rank" data-testid="copy-rank">${icon('swap', 14)}複製順位到其他聯盟…</button><button class="btn small" data-act="clear-rank" data-testid="clear-myrank">清空我的順位</button></div></div><div class="myrank" id="yMyRank" data-testid="myrank-list"></div></div>
<div class="panel section"><div class="panel-h"><h3>Yahoo Top 200 <span class="sub" id="yCount"></span></h3></div>
 <div class="toolbar"><div class="grow"><input class="inp" id="ySearch" data-testid="yahoo-search" placeholder="搜尋球員 / Yahoo 名次 / 球隊" autocomplete="off"></div><select class="inp" id="ySort" style="width:auto" data-testid="yahoo-sort" aria-label="排序">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">排序：${l}</option>`).join('')}</select></div>
 <div class="tbl-wrap tall" id="yGrid" data-testid="yahoo-grid"></div><div id="yUnmatched"></div></div>`;
  let q = ''; let sortKey = 'yahoo';
  const byId = () => new Map(app.universe().players.map((p) => [p.id, p]));

  // ---------- my rank list ----------
  function renderMyRank() {
    const el = $('#yMyRank'); const names = app.profile.myRank; const map = byId();
    if (!names.length) { el.innerHTML = '<div class="muted" data-testid="myrank-empty">還沒有我的選人順位。從下方 Yahoo 名單按「＋」加入，再拖曳調整順序。</div>'; return; }
    el.innerHTML = names.map((name, i) => {
      const p = map.get(normalizeName(name)); const yr = p?.yahooRank;
      const team = p ? app.effectiveTeam(p) : '';
      return `<div class="mr-item" data-name="${esc(name)}" data-testid="mr-item"><span class="mr-handle" tabindex="0" role="button" aria-label="拖曳調整 ${esc(name)} 的順位（或按 Alt+↑/↓）" data-handle title="拖曳排序">${icon('grip', 16)}</span><span class="mr-num" data-testid="mr-num">${i + 1}</span>
<span class="pname">${p ? avatarHtml({ ...p, team }, 'sm') : ''}<span style="min-width:0"><span class="nm">${esc(name)}</span><span class="psub">${yr ? `Yahoo #${yr}` : '不在 Yahoo Top 200'}${team && team !== '—' ? ' · ' + esc(team) : ''}</span></span></span>
<span class="mr-acts"><button class="btn small" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移" data-testid="mr-up">${icon('up', 14)}</button><button class="btn small" data-act="down" data-i="${i}" ${i === names.length - 1 ? 'disabled' : ''} aria-label="下移" data-testid="mr-down">${icon('down', 14)}</button><button class="btn small" data-act="rm-rank" data-name="${esc(name)}">移除</button></span></div>`;
    }).join('');
    hydrateAvatars(el, headshots);
  }

  // ---------- drag (pointer events: mouse + touch + pen) ----------
  let drag = null;
  const renumber = (list) => [...list.children].forEach((row, i) => { const n = row.querySelector('.mr-num'); if (n) n.textContent = String(i + 1); });
  function flip(list, mutate) {
    const rows = [...list.children]; const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
    mutate();
    for (const r of rows) {
      if (r === drag?.item) continue;
      const dy = before.get(r) - r.getBoundingClientRect().top;
      if (dy && r.animate) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  $('#yMyRank').addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-handle]'); if (!h || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const list = $('#yMyRank'); const item = h.closest('.mr-item');
    drag = { item, list, id: e.pointerId, h };
    item.classList.add('dragging'); try { h.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  $('#yMyRank').addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const { item, list } = drag; const y = e.clientY;
    const sibs = [...list.children].filter((r) => r !== item);
    let target = null; let before = true;
    for (const s of sibs) { const r = s.getBoundingClientRect(); if (y < r.top + r.height / 2) { target = s; before = true; break; } }
    const cur = item.nextElementSibling;
    if (target) { if (target !== cur) flip(list, () => list.insertBefore(item, target)); }
    else if (list.lastElementChild !== item) flip(list, () => list.appendChild(item));
    renumber(list); void before;
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
  });
  const finish = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { item, list } = drag; item.classList.remove('dragging'); drag = null;
    const order = [...list.children].map((r) => r.dataset.name);
    app.setMyRankOrder(order); // commits once, only if the order actually changed
  };
  $('#yMyRank').addEventListener('pointerup', finish); $('#yMyRank').addEventListener('pointercancel', finish);
  $('#yMyRank').addEventListener('keydown', (e) => {
    const h = e.target.closest('[data-handle]'); if (!h || !e.altKey) return;
    const i = [...$('#yMyRank').children].indexOf(h.closest('.mr-item'));
    if (e.key === 'ArrowUp') { e.preventDefault(); app.moveMyRank(i, i - 1); } else if (e.key === 'ArrowDown') { e.preventDefault(); app.moveMyRank(i, i + 1); }
  });

  // ---------- Yahoo table ----------
  function renderTable() {
    const m = app.model(); const pr = app.profile; const map = byId();
    const myrank = new Map(pr.myRank.map((n, i) => [normalizeName(n), i + 1]));
    let rows = YAHOO_RANKINGS.map((r) => { const p = map.get(normalizeName(r.name)) || null; const ok = p && hasFit(p, m); return { ...r, p, f: ok ? fitIndex(teamFit(p, m)) : null, bf: ok ? fitIndex(baseFit(p, m)) : null, my: myrank.get(normalizeName(r.name)) ?? null }; });
    const withFit = rows.filter((r) => r.f !== null).sort((a, b) => b.f - a.f); const fitRank = new Map(withFit.map((r, i) => [r.rank, i + 1]));
    const qq = normalizeName(q);
    if (qq) rows = rows.filter((r) => { const tm = r.p ? app.effectiveTeam(r.p) : ''; const txt = `${normalizeName(r.name)} ${String(tm).toLowerCase()} ${normalizeName(TEAMS[tm] || '')} ${r.rank}`; return qq.split(' ').every((t) => /^\d+$/.test(t) ? String(r.rank) === t || txt.includes(t) : txt.includes(t)); });
    const num = (r, k) => (r.p && isNum(r.p[k]) ? r.p[k] : -Infinity);
    const sorters = { yahoo: (a, b) => a.rank - b.rank, myrank: (a, b) => ((a.my ?? 9999) - (b.my ?? 9999)) || a.rank - b.rank, fit: (a, b) => (b.f ?? -999) - (a.f ?? -999), pts: (a, b) => num(b, 'pts') - num(a, 'pts'), reb: (a, b) => num(b, 'reb') - num(a, 'reb'), ast: (a, b) => num(b, 'ast') - num(a, 'ast'), '3p': (a, b) => num(b, 'p3') - num(a, 'p3'), at: (a, b) => num(b, 'at') - num(a, 'at') };
    rows.sort(sorters[sortKey]);
    const matched = YAHOO_RANKINGS.filter((r) => map.get(normalizeName(r.name))?.status === 'ok' || map.get(normalizeName(r.name))?.status === 'historical' || map.get(normalizeName(r.name))?.status === 'projection').length;
    const unmatched = YAHOO_RANKINGS.filter((r) => !isNum(map.get(normalizeName(r.name))?.pts));
    $('#yMeta').textContent = ` Top 200：${matched} / 200 有可用統計（含歷史參考與新秀估算）｜我的順位 ${pr.myRank.length} 人。`;
    $('#yCount').textContent = `${rows.length} / ${YAHOO_RANKINGS.length}`;
    if (!rows.length) { $('#yGrid').innerHTML = emptyState('沒有符合的球員', '請調整搜尋條件。', 'yahoo'); }
    else setHtml($('#yGrid'), `<table class="tbl"><thead><tr><th class="c stick s0">Yahoo</th><th class="l stick s-edge" style="left:58px">Player</th><th class="l">我的順位</th><th class="c">L7N Fit</th><th class="c" title="Yahoo 名次 − L7N Fit 名次；正數＝Yahoo 排得比 L7N 低">差距</th>${statHeads()}</tr></thead><tbody>${rows.map((r) => {
      const p = r.p; const fr = fitRank.get(r.rank); const gap = fr != null ? r.rank - fr : null;
      const inRank = r.my !== null;
      const player = p ? playerCell(p, { team: app.effectiveTeam(p), sub: p.position || '' }) : `<span class="pname"><span class="nm">${esc(r.name)}</span></span>`;
      return `<tr class="${p ? rowClass(p) : ''}" data-rank="${r.rank}"><td class="c stick s0"><span class="rank-pill">${r.rank}</span></td><td class="l stick s-edge" style="left:58px">${player}</td>
<td class="l"><button class="btn small ${inRank ? '' : 'primary'}" data-act="toggle-rank" data-name="${esc(r.name)}" data-testid="rank-toggle">${inRank ? `✓ #${r.my} 移除` : `${icon('plus', 13)}加入`}</button></td><td class="c"><span class="fit ${r.f === null ? 'na' : fitTone(r.f)}">${r.f === null ? '—' : r.f.toFixed(0)}</span></td><td class="c ${gap == null ? '' : gap > 0 ? 'rank-up' : gap < 0 ? 'rank-down' : ''}">${gap == null ? '—' : (gap > 0 ? '+' : '') + gap}</td>${p ? statCells(p, m) : STAT_COLUMNS.map(() => '<td>—</td>').join('')}</tr>`;
    }).join('')}</tbody></table>`);
    hydrateAvatars($('#yGrid'), headshots);
    $('#yUnmatched').innerHTML = unmatched.length ? `<details class="sec-note" data-testid="unmatched"><summary style="cursor:pointer">${unmatched.length} 位 Yahoo 球員目前沒有可用統計（比對失敗或資料未收錄，不代表球員不存在）</summary><div style="margin-top:8px">${unmatched.map((r) => `<span class="chipx" style="margin:2px">#${r.rank} ${esc(r.name)}</span>`).join('')}</div></details>` : '';
  }

  // ---------- copy my draft order between leagues ----------
  function openCopyRank() {
    const leagues = app.profiles; const cur = app.profile; const others = leagues.filter((l) => l.id !== cur.id);
    if (!others.length) { toast('只有一個聯盟，請先到控制中心新增另一個聯盟。', { level: 'warn' }); return; }
    const opt = (l) => `<option value="${esc(l.id)}">${esc(l.name)}（順位 ${l.myRank.length} 人）</option>`;
    const html = `<h3>複製選人順位</h3>
<div class="row" style="margin-bottom:10px"><button class="seg active" data-dir="pull" data-testid="copy-dir-pull">從其他聯盟複製到「${esc(cur.name)}」</button><button class="seg" data-dir="push" data-testid="copy-dir-push">把「${esc(cur.name)}」複製到其他聯盟</button></div>
<div id="cpPull"><label class="lbl" for="cpFrom">來源聯盟</label><select class="inp" id="cpFrom" data-testid="copy-from">${others.map(opt).join('')}</select></div>
<div id="cpPush" hidden><label class="lbl">目標聯盟（可多選）</label>${others.map((l) => `<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" data-to="${esc(l.id)}" data-testid="copy-to-${esc(l.name)}"> ${esc(l.name)}（目前順位 ${l.myRank.length} 人）</label>`).join('')}</div>
<div class="lbl" style="margin-top:12px">複製方式</div>
<label class="check" style="display:flex;margin:4px 0"><input type="radio" name="cpMode" value="merge" checked data-testid="copy-mode-merge"> 合併：保留目標原本的順序，只把它沒有的球員接在後面</label>
<label class="check" style="display:flex;margin:4px 0"><input type="radio" name="cpMode" value="replace" data-testid="copy-mode-replace"> 覆蓋：目標的順位整份換成來源的順序</label>
<p class="tiny" id="cpPreview" data-testid="copy-preview" style="margin:10px 0 0"></p>
<div class="modal-actions"><button class="btn" data-dlg-cancel>取消</button><button class="btn primary" data-dlg-ok data-testid="copy-confirm">複製</button></div>`;
    openModal(html, { onMount: (wrap, close) => {
      let dir = 'pull'; const $w = (q) => wrap.querySelector(q);
      const sel = () => { const mode = wrap.querySelector('input[name="cpMode"]:checked').value; if (dir === 'pull') return { fromId: $w('#cpFrom').value, toIds: [cur.id], mode }; return { fromId: cur.id, toIds: [...wrap.querySelectorAll('[data-to]:checked')].map((c) => c.dataset.to), mode }; };
      const preview = () => {
        const { fromId, toIds, mode } = sel(); const src = leagues.find((l) => l.id === fromId);
        const lines = toIds.map((id) => { const t = leagues.find((l) => l.id === id); const after = mode === 'replace' ? src.myRank.length : t.myRank.length + src.myRank.filter((n) => !t.myRank.includes(n)).length; return `「${t.name}」：${t.myRank.length} → ${after} 人`; });
        $w('#cpPreview').textContent = !src.myRank.length ? `「${src.name}」還沒有選人順位可以複製。` : lines.length ? lines.join('；') : '請選擇至少一個目標聯盟。';
        $w('[data-dlg-ok]').disabled = !src.myRank.length || !toIds.length;
      };
      wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (!b) return; dir = b.dataset.dir; wrap.querySelectorAll('[data-dir]').forEach((x) => x.classList.toggle('active', x === b)); $w('#cpPull').hidden = dir !== 'pull'; $w('#cpPush').hidden = dir !== 'push'; preview(); });
      wrap.addEventListener('change', preview); preview();
      $w('[data-dlg-ok]').addEventListener('click', () => {
        const r = app.copyRank(sel());
        if (!r.ok) { toast(r.error, { level: 'warn' }); return; }
        toast(`已複製選人順位：${r.results.map((x) => `${x.name}（${x.before} → ${x.after} 人）`).join('、')}`, { level: 'ok', ms: 5000 }); close(true);
      });
    } });
  }
  const onSearch = debounce(renderTable, 80);
  $('#ySearch').addEventListener('input', (e) => { q = e.target.value; onSearch(); });
  $('#ySort').addEventListener('change', (e) => { sortKey = e.target.value; renderTable(); });
  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act;
    if (a === 'toggle-rank') app.toggleMyRank(t.dataset.name);
    else if (a === 'rm-rank') app.toggleMyRank(t.dataset.name);
    else if (a === 'clear-rank') app.clearMyRank();
    else if (a === 'copy-rank') openCopyRank();
    else if (a === 'up') app.moveMyRank(Number(t.dataset.i), Number(t.dataset.i) - 1);
    else if (a === 'down') app.moveMyRank(Number(t.dataset.i), Number(t.dataset.i) + 1);
  });
  on(root, 'click', '[data-detail]', (e, t) => ctx.showPlayer(t.dataset.detail));
  void badge; void $$; void buildSearchIndex;
  return { id: 'yahoo', topics: ['myrank', 'roster', 'weights', 'settings', 'data', 'teams', 'league', 'opp'], render() { $('#ySort').value = sortKey; renderMyRank(); renderTable(); } };
}
