// ② Weekly H2H: week picker, both rosters with per-player game counts, category-by-category forecast, strategy summary.
import { $, esc, on, setHtml } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { teamTotals, projectedGames, h2hRows, h2hRecord, strategy } from '../engine/weekly.js';
import { H2H_RAW_KEY, RULES } from '../engine/schema.js';
import { fmt1, fmt2, pct, fmtWeekly, signed } from '../ui/format.js';
import { emptyState, badge, rookieBadge, statusBadge } from '../components/badges.js';
import { avatarHtml, hydrateAvatars } from '../components/avatar.js';
import { WEEKS } from '../data/static/schedule.js';
import { TEAMS } from '../data/static/teams.js';
import { isNum } from '../engine/util.js';

const gapText = (key, gap) => {
  if (!isNum(gap)) return '—';
  if (['FG', 'FT', 'P3'].includes(key)) return signed(gap * 100, 1) + ' pt';
  return signed(gap, key === 'AT' ? 2 : 1);
};

export function createWeeklyView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-weekly');
  root.innerHTML = `
<div class="panel section"><div class="panel-h"><h3>Weekly H2H Projection</h3>
 <div class="weekbar"><button class="icon-btn" data-act="wk-prev" aria-label="上一週" data-testid="wk-prev">${icon('left', 18)}</button><select class="inp" id="wkSelect" data-testid="week-select" aria-label="選擇賽週"></select><button class="icon-btn" data-act="wk-next" aria-label="下一週" data-testid="wk-next">${icon('right', 18)}</button></div></div>
 <div class="panel-b" id="wkSummary"></div></div>
<div class="vs-grid section"><div class="panel"><div class="panel-h"><h3>我的球隊 <span class="sub" id="wkMineSub"></span></h3><button class="btn small primary" data-act="add-me">${icon('plus', 14)}新增</button></div><div class="panel-b roster-list" id="wkMine" data-testid="wk-mine"></div></div>
 <div class="panel"><div class="panel-h"><h3>對手的球隊 <span class="sub" id="wkOppSub"></span></h3><div class="row"><button class="btn small primary" data-act="add-opp" data-testid="add-opp">${icon('plus', 14)}新增對手球員</button><button class="btn small" data-act="clear-opp" data-testid="clear-opp">清空</button></div></div><div class="panel-b roster-list" id="wkOpp" data-testid="wk-opp"></div></div></div>
<div class="panel section"><div class="panel-h"><h3>預測 Matchup Totals <span class="sub">百分比 = 總命中 ÷ 總出手；A/T = 總 AST ÷ 總 TOV；DD = DD/G × 預測場次（預估）</span></h3></div><div class="tbl-wrap" id="wkTable" data-testid="matchup-table"></div><p class="sec-note">勾選的分類會列入 H2H 比較（每個聯盟各自記住）。FGM/A、FTM/A、3PTM/A 僅作命中／出手資訊，不是獨立的 H2H 分類。TOV 越低越好。「接近」為相差 &lt; ${(RULES.closeRel * 100).toFixed(0)}% 的提示標記，不影響勝負判定。</p></div>
<div class="panel section"><div class="panel-h"><h3>本週 H2H 策略 <span class="sub">只根據本週你 vs 對手的預測結果</span></h3></div><div class="panel-b" id="wkStrategy" data-testid="wk-strategy"></div></div>`;

  const sel = $('#wkSelect');
  sel.innerHTML = WEEKS.map((w, i) => `<option value="${i}">${w[0]} · ${w[1]}</option>`).join('');
  sel.addEventListener('change', (e) => app.setWeek(e.target.value));

  const rosterRows = (players, names, who, wctx) => {
    if (!names.length) return `<div class="muted">${who === 'opp' ? '尚未輸入對手 roster。按「新增對手球員」建立。' : '尚未選擇球員。'}</div>`;
    return names.map((name) => {
      const p = app.playerByName(name);
      if (!p) return `<div class="rl-row"><span class="muted">${esc(name)} ${badge('資料中找不到', 'amber')}</span><span></span><button class="icon-btn" data-act="rm-${who}" data-name="${esc(name)}" aria-label="移除">${icon('close', 16)}</button></div>`;
      const g = projectedGames(p, wctx);
      const cls = g.source === 'override' ? 'ov' : g.source === 'assumed' ? 'as' : '';
      return `<div class="rl-row" data-name="${esc(p.name)}"><span class="pname">${avatarHtml({ ...p, team: g.team }, 'md')}<span style="min-width:0"><button class="plink" data-detail="${esc(p.name)}"><span class="nm">${esc(p.name)}</span></button><span class="psub">${esc(TEAMS[g.team] || g.team)} ${rookieBadge(p)} ${statusBadge(p)}${g.source === 'assumed' ? badge('賽程未知 · 暫估 3 場', 'amber') : ''}</span></span></span>
<span class="stepper sm ${cls}"><button data-act="g-dec" data-name="${esc(p.name)}" aria-label="減少場次">−</button><b data-testid="wk-games-${who}-${esc(p.name)}">${g.games}</b><button data-act="g-inc" data-name="${esc(p.name)}" aria-label="增加場次">+</button></span>
<span class="row" style="gap:2px">${g.source === 'override' ? `<button class="icon-btn" style="width:28px;height:28px" data-act="g-reset" data-name="${esc(p.name)}" title="還原賽程場次">↺</button>` : ''}<button class="icon-btn" style="width:28px;height:28px" data-act="rm-${who}" data-name="${esc(p.name)}" aria-label="移除 ${esc(p.name)}">${icon('close', 15)}</button></span></div>`;
    }).join('');
  };

  function render() {
    const p = app.profile; const wctx = app.weeklyCtx();
    sel.value = String(p.week);
    const mineP = app.rosterPlayers(p.selected); const oppP = app.rosterPlayers(p.oppSelected);
    const mine = teamTotals(mineP, wctx); const opp = teamTotals(oppP, wctx);
    $('#wkMineSub').textContent = `${p.selected.length} 人 · ${mine.totalPG} Player-Games`;
    $('#wkOppSub').textContent = `${p.oppSelected.length} 人 · ${opp.totalPG} Player-Games`;
    setHtml($('#wkMine'), rosterRows(mineP, p.selected, 'me', wctx));
    setHtml($('#wkOpp'), rosterRows(oppP, p.oppSelected, 'opp', wctx));
    hydrateAvatars($('#wkMine'), headshots); hydrateAvatars($('#wkOpp'), headshots);

    const cats = new Set(p.h2hCategories);
    const rows = h2hRows(mine, opp, cats);
    const hasOpp = oppP.length > 0;
    const live = hasOpp ? rows.filter((r) => isNum(r.a) && isNum(r.b)) : [];
    const rec = h2hRecord(live);

    // summary
    const warn = [];
    const assumed = [...new Set([...mine.flags.assumed, ...opp.flags.assumed])];
    const noStats = [...new Set([...mine.flags.noStats, ...opp.flags.noStats])];
    const hist = [...new Set([...mine.flags.historical, ...opp.flags.historical])];
    if (assumed.length) warn.push(`${assumed.length} 位球員的球隊找不到賽程，暫以 ${RULES.defaultGames} 場估算：${assumed.join('、')}`);
    if (noStats.length) warn.push(`${noStats.length} 位球員沒有統計資料，未計入預測：${noStats.join('、')}`);
    if (hist.length) warn.push(`使用歷史參考數據（不是本季實績）：${hist.join('、')}`);
    $('#wkSummary').innerHTML = `<div class="row sp"><div class="scoreline" style="margin:0"><div><span class="tiny">H2H 預測 · ${WEEKS[p.week][0]} · ${WEEKS[p.week][1]}</span><br><b data-testid="record">${hasOpp && live.length ? `${rec.w}–${rec.l}${rec.t ? '–' + rec.t : ''}` : '—'}</b></div>
 <div><span class="tiny">我方 / 對手 Player-Games</span><br><b>${mine.totalPG} <span class="dim">/</span> ${opp.totalPG}</b></div>
 <div><span class="tiny">DD 預估（你 − 對手）</span><br><b>${fmt1(mine.raw.DD)} <span class="dim">vs</span> ${hasOpp ? fmt1(opp.raw.DD) : '—'}</b></div></div></div>
 ${hasOpp ? '' : `<div class="banner info" style="margin:10px 0 0">${icon('info', 16)}<div>先輸入對手 roster，才會有 H2H 勝負預測；目前只顯示你的本週預估總量。</div></div>`}
 ${warn.map((w) => `<div class="banner warn" style="margin:10px 0 0">${icon('alert', 16)}<div>${esc(w)}</div></div>`).join('')}`;

    // table
    const R = (raw, o) => o; void R;
    const rowDefs = [
      { label: 'FGM/A', info: (t) => `${fmt1(t.raw.FGM)} / ${fmt1(t.raw.FGA)}` }, { label: 'FG%' },
      { label: 'FTM/A', info: (t) => `${fmt1(t.raw.FTM)} / ${fmt1(t.raw.FTA)}` }, { label: 'FT%' }, { label: 'FTM' },
      { label: '3PTM/A', info: (t) => `${fmt1(t.raw.P3M)} / ${fmt1(t.raw.P3A)}` }, { label: '3P%' }, { label: '3PM' },
      { label: 'PTS' }, { label: 'REB' }, { label: 'AST' }, { label: 'STL' }, { label: 'BLK' }, { label: 'TOV' }, { label: 'DD', show: 'DD（預估）' }, { label: 'A/T' },
    ];
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    const allRows = rowDefs.map((d) => {
      if (d.info) return `<tr class="dim"><td class="l dim">${d.label}</td><td>${d.info(mine)}</td><td>${hasOpp ? d.info(opp) : '—'}</td><td></td><td></td><td></td></tr>`;
      const key = H2H_RAW_KEY[d.label]; const on_ = cats.has(d.label);
      const r = byLabel.get(d.label);
      const a = mine.raw[key]; const b = opp.raw[key];
      let res = ''; let gap = ''; let bar = '';
      if (on_ && hasOpp && r && isNum(r.a) && isNum(r.b)) {
        res = `<span class="res-${r.cls}">${r.txt === '你' ? '你領先' : r.txt === '對手' ? '對手領先' : '平'}</span>${r.close && r.cls !== 'tie' ? '<span class="close-tag">接近</span>' : ''}`;
        gap = gapText(key, r.gap);
        const w = Math.min(50, (r.rel ?? 0) * (['FG', 'FT', 'P3'].includes(key) ? 400 : 100));
        bar = `<div class="delta-bar" style="min-width:90px"><i class="${r.cls === 'win' ? 'pos' : r.cls === 'loss' ? 'neg' : ''}" style="${r.cls === 'win' ? 'left:50%' : 'right:50%'};width:${w}%"></i></div>`;
      }
      return `<tr data-cat="${esc(d.label)}"><td class="l"><label class="check"><input type="checkbox" data-h2h="${esc(d.label)}" ${on_ ? 'checked' : ''} aria-label="將 ${esc(d.label)} 列入 H2H" data-testid="h2h-${esc(d.label)}"> <b>${esc(d.show || d.label)}</b></label></td>
<td class="${r && on_ && hasOpp && r.cls === 'win' ? 'good' : ''}">${fmtWeekly(key, a)}</td><td class="${r && on_ && hasOpp && r.cls === 'loss' ? 'bad' : ''}">${hasOpp ? fmtWeekly(key, b) : '—'}</td><td>${gap}</td><td style="min-width:100px">${bar}</td><td class="l">${res}</td></tr>`;
    }).join('');
    setHtml($('#wkTable'), `<table class="tbl"><thead><tr><th class="l">Category</th><th>你</th><th>對手</th><th>差距（你視角）</th><th></th><th class="l">預測</th></tr></thead><tbody>${allRows}</tbody></table>`);

    // strategy
    const st = $('#wkStrategy');
    if (!cats.size) { st.innerHTML = emptyState('尚未選擇 H2H 項目', '請在上方表格勾選要比較的分類。', 'info'); return; }
    if (!hasOpp) { st.innerHTML = emptyState('先輸入對手 roster', '有對手後，這裡會整理「主要壓力、最接近翻盤、可以守住」。', 'weekly'); return; }
    const S = strategy(live);
    const tags = (arr, n) => arr.slice(0, n).map((x) => `<span class="stag ${x.cls}">${esc(x.label)} ${gapText(x.key, x.gap)}</span>`).join('');
    st.innerHTML = `<div class="strategy"><div class="scard loss"><h4>🔴 主要壓力</h4>${S.mainPressure.length ? tags(S.mainPressure, 2) : '<span class="muted">目前沒有明顯落後項目</span>'}<p>相對對手落後最多的分類；想改變本週結果，先從這裡找補強方向。</p></div>
<div class="scard flip"><h4>🟡 最接近翻盤</h4>${S.nearLoss.length ? tags(S.nearLoss, 2) : '<span class="muted">沒有落後但接近的分類</span>'}<p>差距較小的落後分類，比「輸很多」更可能用少量陣容調整翻過來。</p></div>
<div class="scard win"><h4>🟢 可以守住</h4>${S.strongWins.length ? tags(S.strongWins, 3) : '<span class="muted">目前沒有明顯優勢</span>'}<p>這些項目站在你這邊，不需要為了這場特別犧牲其他分類去追。</p></div></div>
<div class="scoreline" style="margin-bottom:0"><span><b data-testid="strategy-line">${S.wins.length} 項領先、${S.losses.length} 項落後${S.ties.length ? `、${S.ties.length} 項平手` : ''}</b>${S.nearLoss.length ? `　最值得先觀察：${S.nearLoss.map((x) => esc(x.label)).join('、')}` : ''}</span></div>`;
    void fmt2; void pct;
  }

  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act; const n = t.dataset.name;
    if (a === 'wk-prev') app.setWeek(app.profile.week - 1);
    else if (a === 'wk-next') app.setWeek(app.profile.week + 1);
    else if (a === 'add-me') ctx.quickAdd.open('me');
    else if (a === 'add-opp') ctx.quickAdd.open('opp');
    else if (a === 'clear-opp') app.clearOpp();
    else if (a === 'rm-opp') app.removeOpp(n);
    else if (a === 'rm-me') app.removePlayer(n);
    else if (a === 'g-inc' || a === 'g-dec') { const cur = projectedGames(app.playerByName(n), app.weeklyCtx()).games; app.setGames(n, cur + (a === 'g-inc' ? 1 : -1)); }
    else if (a === 'g-reset') app.setGames(n, null);
  });
  on(root, 'change', '[data-h2h]', (e, t) => app.toggleH2H(t.dataset.h2h, t.checked));
  on(root, 'click', '[data-detail]', (e, t) => ctx.showPlayer(t.dataset.detail));

  return { id: 'weekly', topics: ['roster', 'opp', 'week', 'games', 'teams', 'h2h', 'league', 'settings', 'weights'], render };
}
