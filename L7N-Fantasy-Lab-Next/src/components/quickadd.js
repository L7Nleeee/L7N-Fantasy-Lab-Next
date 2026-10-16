// Command-palette style player search: add to my team / opponent / What-if from anywhere (press "/" or Ctrl/⌘+K).
import { esc, $, $$ } from '../ui/dom.js';
import { avatarHtml, hydrateAvatars } from './avatar.js';
import { buildSearchIndex, searchPlayers } from '../engine/search.js';
import { TEAMS } from '../data/static/teams.js';
import { statusBadge, rookieBadge, emptyState } from './badges.js';
import { fmt1 } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import { toast } from './toast.js';

export function createQuickAdd(app, headshots) {
  const wrap = document.createElement('div');
  wrap.className = 'palette-wrap'; wrap.hidden = true;
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="搜尋球員">
    <div class="palette-head">${icon('players', 18)}<input id="qaInput" data-testid="qa-input" class="palette-input" placeholder="搜尋球員、球隊或 Yahoo 名次，例如 Wemby / Jokic / LAL / 12" autocomplete="off" spellcheck="false"><button class="icon-btn" data-qa-close aria-label="關閉">${icon('close', 18)}</button></div>
    <div class="palette-targets" role="tablist"><button class="seg" data-target="me">加入我的球隊</button><button class="seg" data-target="opp">加入對手</button><button class="seg" data-target="what">What-if 模擬</button></div>
    <div id="qaResults" class="palette-results" data-testid="qa-results"></div></div>`;
  document.body.appendChild(wrap);
  let target = 'me'; let index = null; let idxKey = ''; let results = []; let sel = 0;
  const input = $('#qaInput', wrap); const box = $('#qaResults', wrap);

  const ensureIndex = () => { const u = app.universe(); const k = `${app.repo.revision}|${app.profile.dataBasis}`; if (k !== idxKey) { index = buildSearchIndex(u.players); idxKey = k; } };
  const state = (p) => { const pr = app.profile; return pr.selected.includes(p.name) ? 'me' : pr.oppSelected.includes(p.name) ? 'opp' : ''; };

  function render() {
    ensureIndex();
    $$('.seg', wrap).forEach((b) => b.classList.toggle('active', b.dataset.target === target));
    const q = input.value.trim();
    if (!q) { results = []; box.innerHTML = emptyState('輸入關鍵字開始搜尋', '可輸入姓名（不分大小寫與重音）、球隊代碼或 Yahoo 名次。', 'players'); return; }
    results = searchPlayers(index, q, { limit: 30 });
    sel = Math.min(sel, Math.max(0, results.length - 1));
    if (!results.length) { box.innerHTML = emptyState('找不到符合的球員', '這不代表球員不存在：可能是資料中尚未收錄或名字拼法不同。', 'info'); return; }
    box.innerHTML = results.map((p, i) => {
      const st = state(p);
      const line = [TEAMS[app.effectiveTeam(p)] || app.effectiveTeam(p), p.isRookie && p.draftPick ? `Pick #${p.draftPick}` : null, p.yahooRank ? `Yahoo #${p.yahooRank}` : null].filter(Boolean).join(' · ');
      const stats = Number.isFinite(p.pts) ? `PTS ${fmt1(p.pts)} · REB ${fmt1(p.reb)} · AST ${fmt1(p.ast)}` : '尚無統計';
      return `<div class="qa-row ${i === sel ? 'sel' : ''}" data-i="${i}" data-name="${esc(p.name)}">${avatarHtml(p, 'md')}<div class="qa-main"><div class="qa-name">${esc(p.name)} ${rookieBadge(p)} ${statusBadge(p)}</div><div class="qa-sub">${esc(line)}</div><div class="qa-sub dim">${stats}</div></div>
      <div class="qa-act">${st ? `<span class="badge b-green">${st === 'me' ? '已在我的球隊' : '已在對手'}</span>` : `<button class="btn small primary" data-do="add" data-testid="qa-add">${icon('plus', 14)}加入</button>`}</div></div>`;
    }).join('');
    hydrateAvatars(box, headshots);
  }

  function act(name) {
    const p = app.playerByName(name); if (!p) return;
    if (target === 'me') { if (!state(p)) { app.addPlayer(name); toast(`已加入我的球隊：${name}`, { level: 'ok' }); } }
    else if (target === 'opp') { if (!state(p)) { app.addOpp(name); toast(`已加入對手：${name}`, { level: 'ok' }); } }
    else { const r = app.toggleWhatIn(name); if (!r.ok) toast(r.error, { level: 'warn' }); else toast(`What-if：${app.profile.whatIn.includes(name) ? '加入' : '取消'} ${name}`); }
    render(); input.focus();
  }

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-qa-close]')) { close(); return; }
    const seg = e.target.closest('.seg'); if (seg) { target = seg.dataset.target; render(); input.focus(); return; }
    const row = e.target.closest('.qa-row'); if (row && e.target.closest('[data-do]')) act(row.dataset.name);
  });
  input.addEventListener('input', () => { sel = 0; render(); });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); $('.qa-row.sel', wrap)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); $('.qa-row.sel', wrap)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); act(results[sel].name); }
  });

  function open(t) { target = t || target; wrap.hidden = false; document.body.classList.add('no-scroll'); requestAnimationFrame(() => wrap.classList.add('in')); input.value = ''; sel = 0; render(); input.focus(); }
  function close() { wrap.classList.remove('in'); document.body.classList.remove('no-scroll'); setTimeout(() => { wrap.hidden = true; }, 140); }
  return { open, close, get isOpen() { return !wrap.hidden; } };
}
