// ③ NBA schedule: per-week games heat grid, density for MY players, and manual team (trade) overrides.
import { $, esc, on, setHtml } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { SCHEDULE, WEEKS, SCHEDULE_META } from '../data/static/schedule.js';
import { TEAMS, TEAM_CODES } from '../data/static/teams.js';
import { TEAM_SNAPSHOT_DATE } from '../data/static/team-overrides.js';
import { emptyState } from '../components/badges.js';
import { playerCell } from '../components/statcells.js';
import { hydrateAvatars } from '../components/avatar.js';
import { projectedGames } from '../engine/weekly.js';

export function createScheduleView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-schedule');
  root.innerHTML = `
<div class="panel section"><div class="panel-h"><h3>2026-27 NBA Weekly Schedule Grid <span class="sub">紫色 = 4+ 場高密度週 · 洋紅標記 = 你的球員所在球隊 · 點週別可切換目前賽週</span></h3>
 <div class="row"><select class="inp" id="schSort" style="width:auto" aria-label="排序" data-testid="sch-sort"><option value="team">排序：隊伍代碼</option><option value="week">排序：本週場次（多→少）</option><option value="mine">排序：我的球員優先</option></select></div></div>
 <div class="panel-b" id="schSummary"></div><div class="tbl-wrap tall" id="schGrid" data-testid="schedule-grid"></div></div>
<div class="panel section"><div class="panel-h"><h3>球隊對照與季中交易覆寫 <span class="sub">只影響賽程場次的計算，不會改動球員統計</span></h3></div><div class="tbl-wrap mid" id="schTeams" data-testid="team-overrides"></div>
 <p class="sec-note">預設的 2026-27 所屬球隊是 ${TEAM_SNAPSHOT_DATE} 的快照（對照 NBA.com 官方 2026 休賽季交易）。沒有即時交易來源，季中換隊請在這裡手動調整；覆寫會依聯盟各自保存，賽程或資料更新不會清除它。要覆寫其他球員，先把他加入我的球隊或對手。</p></div>
<div class="banner info">${icon('info', 18)}<div><b>賽程來源與限制</b>${esc(SCHEDULE_META.source)}。${esc(SCHEDULE_META.note)}</div></div>`;

  let sortMode = 'team';
  $('#schSort').addEventListener('change', (e) => { sortMode = e.target.value; render(); });

  function render() {
    const p = app.profile; const wk = p.week;
    const mineP = app.rosterPlayers(p.selected);
    const wctx = app.weeklyCtx();
    const countBy = {};
    for (const pl of mineP) { const t = app.effectiveTeam(pl); countBy[t] = (countBy[t] || 0) + 1; }
    const pg = mineP.reduce((s, x) => s + projectedGames(x, wctx).games, 0);
    $('#schSummary').innerHTML = `<div class="row"><span class="hint-chip">目前賽週：<b>${WEEKS[wk][0]}</b> · ${WEEKS[wk][1]}</span><span class="hint-chip">我的球員 ${mineP.length} 人 · 本週 ${pg} Player-Games</span><span class="hint-chip">圖例：<span class="g4" style="padding:0 6px;border-radius:5px">4</span> 高密度　<span class="g1" style="padding:0 6px">1</span> 低</span></div>`;
    let teams = [...TEAM_CODES];
    if (sortMode === 'week') teams.sort((a, b) => (SCHEDULE[b][wk] - SCHEDULE[a][wk]) || a.localeCompare(b));
    else if (sortMode === 'mine') teams.sort((a, b) => ((countBy[b] || 0) - (countBy[a] || 0)) || a.localeCompare(b));
    const head = WEEKS.map((w, i) => `<th class="wk ${i === wk ? 'cur' : ''}" data-act="wk" data-i="${i}" title="${esc(w[1])}" data-testid="wk-th-${i}">${w[0]}<span>${esc(w[1].split('–')[0])}</span></th>`).join('');
    const body = teams.map((t) => {
      const cells = SCHEDULE[t].map((g, i) => `<td class="g g${Math.min(g, 5)} ${i === wk ? 'cur' : ''}">${g}</td>`).join('');
      const n = countBy[t];
      return `<tr class="${n ? 'mine' : ''}" data-team="${t}"><td class="l stick s0 s-edge"><b>${t}</b> <span class="muted">${esc(TEAMS[t])}</span>${n ? `<span class="mine-n">${n} 人</span>` : ''}</td><td><b>${SCHEDULE[t].reduce((a, b) => a + b, 0)}</b></td>${cells}</tr>`;
    }).join('');
    setHtml($('#schGrid'), `<table class="tbl sch"><thead><tr><th class="l stick s0 s-edge">Team</th><th>Total</th>${head}</tr></thead><tbody>${body}</tbody></table>`);

    // overrides
    const names = [...new Set([...p.selected, ...p.oppSelected])];
    const el = $('#schTeams');
    if (!names.length) { el.innerHTML = emptyState('還沒有可覆寫的球員', '把球員加入我的球隊或對手後，就能在這裡調整他的所屬球隊。', 'schedule'); return; }
    const opts = (cur) => `<option value="">（使用預設）</option>` + TEAM_CODES.map((t) => `<option value="${t}" ${cur === t ? 'selected' : ''}>${t} · ${esc(TEAMS[t])}</option>`).join('');
    setHtml(el, `<table class="tbl"><thead><tr><th class="l">Player</th><th class="l">預設球隊（快照）</th><th class="l">手動覆寫</th><th>本週場次</th></tr></thead><tbody>${names.map((n) => {
      const pl = app.playerByName(n);
      if (!pl) return `<tr><td class="l">${esc(n)}</td><td class="l dim" colspan="3">資料中找不到</td></tr>`;
      const ov = p.teamOverrides[n] || '';
      const g = projectedGames(pl, wctx);
      return `<tr><td class="l">${playerCell(pl, { team: app.effectiveTeam(pl) })}</td><td class="l">${esc(pl.team)}${pl.baselineTeam && pl.baselineTeam !== pl.team ? ` <span class="dim">（上季 ${esc(pl.baselineTeam)}）</span>` : ''}</td>
<td class="l"><select class="inp" style="width:210px;height:32px" data-team-for="${esc(n)}" data-testid="team-ov-${esc(n)}" aria-label="${esc(n)} 球隊覆寫">${opts(ov)}</select></td><td>${g.games}${g.source === 'assumed' ? ' <span class="badge b-amber">暫估</span>' : ''}</td></tr>`;
    }).join('')}</tbody></table>`);
    hydrateAvatars(el, headshots);
  }

  on(root, 'click', '[data-act="wk"]', (e, t) => app.setWeek(Number(t.dataset.i)));
  on(root, 'change', '[data-team-for]', (e, t) => app.setTeam(t.dataset.teamFor, t.value));
  on(root, 'click', '[data-detail]', (e, t) => ctx.showPlayer(t.dataset.detail));
  return { id: 'schedule', topics: ['roster', 'opp', 'week', 'games', 'teams', 'league', 'settings'], render };
}
