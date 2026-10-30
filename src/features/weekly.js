// ② Weekly H2H — with per-basis selector, trend tags and FA pickup recommender.
import { $, esc, on, setHtml, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { teamTotals, projectedGames, h2hRows, h2hRecord, strategy } from '../engine/weekly.js';
import { H2H_RAW_KEY, RULES, DATA_BASES } from '../engine/schema.js';
import { buildTrendMap, trendBadgeHtml, rankFAPickups } from '../engine/trend.js';
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

const BASIS_OPTS = ['current', 'recent10', 'recent30d', 'last'];

export function createWeeklyView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-weekly');
  root.innerHTML = `
<div class="panel section">
  <div class="panel-h">
    <h3>Weekly H2H Projection</h3>
    <div class="weekbar">
      <button class="icon-btn" data-act="wk-prev" aria-label="上一週" data-testid="wk-prev">${icon('left', 18)}</button>
      <select class="inp" id="wkSelect" data-testid="week-select" aria-label="選擇賽週"></select>
      <button class="icon-btn" data-act="wk-next" aria-label="下一週" data-testid="wk-next">${icon('right', 18)}</button>
    </div>
  </div>
  <div class="panel-b" id="wkSummary"></div>
</div>
<div class="panel section" id="wkBasisPanel">
  <div class="panel-h" style="flex-wrap:nowrap">
    <h3>預測數據基準 <span class="sub">這裡的選擇只影響 H2H 預測，不改變選人頁面的設定</span></h3>
    <div class="row" id="wkBasisBtns" style="flex-wrap:nowrap;gap:4px"></div>
  </div>
  <div id="wkTrendNote" class="panel-b" style="padding:8px 16px"></div>
</div>
<div class="vs-grid section">
  <div class="panel"><div class="panel-h"><h3>我的球隊 <span class="sub" id="wkMineSub"></span></h3><button class="btn small primary" data-act="add-me">${icon('plus', 14)}新增</button></div><div class="panel-b roster-list" id="wkMine" data-testid="wk-mine"></div></div>
  <div class="panel"><div class="panel-h" style="flex-wrap:wrap;gap:6px"><h3>對手的球隊 <span class="sub" id="wkOppSub"></span></h3><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn small primary" data-act="add-opp" data-testid="add-opp">${icon('plus', 14)}新增球員</button><button class="btn small" data-act="save-opp" data-testid="save-opp">${icon('check',13)}儲存此對手</button><button class="btn small" data-act="clear-opp" data-testid="clear-opp">清空</button></div></div>
  <div id="wkSavedOpps" style="padding:0 14px 10px"></div>
  <div class="panel-b roster-list" id="wkOpp" data-testid="wk-opp"></div></div>
</div>
<div class="panel section"><div class="panel-h"><h3>預測 Matchup Totals <span class="sub">百分比 = 總命中 ÷ 總出手；A/T = 總 AST ÷ 總 TOV；DD = DD/G × 預測場次（預估）</span></h3></div><div class="tbl-wrap" id="wkTable" data-testid="matchup-table"></div>
<p class="sec-note">勾選的分類會列入 H2H 比較。TOV 越低越好。「接近」為相差 &lt; ${(RULES.closeRel * 100).toFixed(0)}% 的提示標記，不影響勝負判定。</p></div>
<div class="panel section"><div class="panel-h"><h3>本週策略 <span class="sub">只根據本週你 vs 對手的預測結果</span></h3></div><div class="panel-b" id="wkStrategy" data-testid="wk-strategy"></div></div>
<div class="panel section" id="wkPickupPanel"><div class="panel-h"><h3>🎯 本週補強推薦 <span class="sub">從自由球員池中，誰能最有效翻轉你落後的分類？</span></h3></div><div class="panel-b" id="wkPickup"></div></div>`;

  const sel = $('#wkSelect');
  sel.innerHTML = WEEKS.map((w, i) => `<option value="${i}">${w[0]} · ${w[1]}</option>`).join('');
  sel.addEventListener('change', (e) => app.setWeek(e.target.value));

  // ---- basis selector ----
  function renderBasisBtns() {
    const wb = app.profile.weeklyBasis;
    const hasRecent10 = !!app.repo.getDataset('recent10');
    const hasCurrent  = !!app.repo.getDataset('current');
    $('#wkBasisBtns').innerHTML = BASIS_OPTS.map((b) => {
      const d = DATA_BASES[b]; const available = !!app.repo.getDataset(b);
      const tip = !available ? '（尚未載入）' : '';
      return `<button class="seg ${wb === b ? 'active' : ''}" data-basis="${b}" ${!available ? 'disabled title="尚未載入這份資料"' : ''} data-testid="wb-${b}">${d.short}${tip}</button>`;
    }).join('');
    const note = $('#wkTrendNote');
    const canTrend = hasRecent10 && hasCurrent;
    note.innerHTML = canTrend
      ? `<span class="badge b-green">${icon('check', 13)} 近況標籤已啟用</span> <span class="tiny">近 10 場 vs 本季至今的差值：↑ ≥10% = 上揚，🔥 ≥25% = 爆發；↓ ≤-10% = 下滑，🧊 ≤-25% = 低潮。<b>同時載入「本季至今」與「近 10 場」資料即可使用。</b></span>`
      : `<span class="badge b-amber">近況標籤暫不可用</span> <span class="tiny">請在控制中心同時載入「本季至今」與「近 10 場」資料，才能顯示球員近況標籤。</span>`;
  }

  // ---- trend map ----
  function getTrendMap(names) {
    const hasR10 = !!app.repo.getDataset('recent10');
    const hasCur = !!app.repo.getDataset('current');
    if (!hasR10 || !hasCur) return new Map();
    const recentU   = app.repo.universe('recent10');
    const baselineU = app.repo.universe('current');
    const players = names.map((n) => app.playerByName(n)).filter(Boolean);
    return buildTrendMap(players, recentU, baselineU);
  }

  // ---- roster rows ----
  function rosterRows(names, who, wctx, trendMap) {
    if (!names.length) return `<div class="muted">${who === 'opp' ? '尚未輸入對手 roster。按「新增對手球員」建立。' : '尚未選擇球員。'}</div>`;
    return names.map((name) => {
      const p = app.playerByName(name);
      if (!p) return `<div class="rl-row"><span class="muted">${esc(name)} ${badge('資料中找不到', 'amber')}</span><span></span><button class="icon-btn" data-act="rm-${who}" data-name="${esc(name)}" aria-label="移除">${icon('close', 16)}</button></div>`;
      const g = projectedGames(p, wctx); const tm = g.team;
      const cls = g.source === 'override' ? 'ov' : g.source === 'assumed' ? 'as' : '';
      const trend = trendMap.get(name);
      const tBadge = trendBadgeHtml(trend);
      return `<div class="rl-row" data-name="${esc(p.name)}">
        <span class="pname">${avatarHtml({ ...p, team: tm }, 'md')}<span style="min-width:0">
          <button class="plink" data-detail="${esc(p.name)}"><span class="nm">${esc(p.name)}</span></button>
          <span class="psub">${esc(TEAMS[tm] || tm)} ${rookieBadge(p)} ${statusBadge(p)}${g.source === 'assumed' ? badge('賽程未知 · 暫估 3 場', 'amber') : ''} ${tBadge}</span>
        </span></span>
        <span class="stepper sm ${cls}"><button data-act="g-dec" data-name="${esc(p.name)}" aria-label="減少場次">−</button><b data-testid="wk-games-${who}-${esc(p.name)}">${g.games}</b><button data-act="g-inc" data-name="${esc(p.name)}" aria-label="增加場次">+</button></span>
        <span class="row" style="gap:2px">${g.source === 'override' ? `<button class="icon-btn" style="width:28px;height:28px" data-act="g-reset" data-name="${esc(p.name)}" title="還原賽程場次">↺</button>` : ''}<button class="icon-btn" style="width:28px;height:28px" data-act="rm-${who}" data-name="${esc(p.name)}" aria-label="移除 ${esc(p.name)}">${icon('close', 15)}</button></span>
      </div>`;
    }).join('');
  }

  // ---- pickup recommender ----
  function renderPickup(myTeam, opp, lossCats, wctx, h2hCats) {
    const box = $('#wkPickup');
    const wb = app.profile.weeklyBasis;
    const u = app.repo.universe(wb);
    const myNames = new Set(app.profile.selected);
    const oppNames = new Set(app.profile.oppSelected);
    const candidates = u.players.filter((p) =>
      !myNames.has(p.name) && !oppNames.has(p.name) &&
      (p.status === 'ok' || p.status === 'projection') &&
      isNum(p.pts)
    );
    if (!candidates.length) { box.innerHTML = emptyState('候選球員池是空的', '請先載入球員統計資料。', 'players'); return; }
    if (!lossCats.length) { box.innerHTML = `<p class="muted">目前沒有落後的 H2H 分類，無需推薦補強。</p>`; return; }

    const picks = rankFAPickups({ candidates, myTeam, oppTotals: opp, lossCats, weeklyCtx: wctx, h2hCats: app.profile.h2hCategories, topN: 8 });
    if (!picks.length) { box.innerHTML = `<p class="muted">找不到能翻轉這些落後分類的候選球員（資料不足或沒有本週場次）。</p>`; return; }

    const trendMap = getTrendMap(picks.map((r) => r.p.name));
    box.innerHTML = `<p class="tiny" style="margin:0 0 10px">落後分類：${lossCats.map((c) => `<b>${c}</b>`).join('、')}。以下是自由球員中最能翻轉這些分類的候選，加入後預計的 H2H 勝場變化：</p>`
      + picks.map((r) => {
        const { p, boosts, recordDelta, games } = r;
        const trend = trendMap.get(p.name);
        const tBadge = trendBadgeHtml(trend);
        const deltaStr = recordDelta !== 0 ? `<b class="${recordDelta > 0 ? 'good-t' : 'bad-t'}">${recordDelta > 0 ? '+' : ''}${recordDelta} 勝</b>` : '';
        const boostStr = boosts.slice(0, 3).map((b) => `${b.label} ${b.label === 'TOV' ? icon('down', 12) : icon('up', 12)} ${b.delta > 0 && ['FG', 'FT', 'P3'].includes(H2H_RAW_KEY[b.label] || '') ? (b.delta * 100).toFixed(1) + ' pt' : fmt1(b.delta)}`).join('　');
        return `<div class="pickup-row"><span class="pname">${avatarHtml(p, 'md')}<span style="min-width:0"><button class="plink" data-detail="${esc(p.name)}"><span class="nm">${esc(p.name)}</span></button><span class="psub">${esc(TEAMS[app.effectiveTeam(p)] || app.effectiveTeam(p))} · 本週 ${games} 場 ${tBadge}</span></span></span>
          <span class="pickup-stats"><span class="tiny muted">改善：${boostStr}</span> ${deltaStr}</span>
          <button class="btn small primary" data-act="add" data-name="${esc(p.name)}" data-testid="pickup-add">${icon('plus', 13)}加入球隊</button></div>`;
      }).join('');
    hydrateAvatars(box, headshots);
  }

  function renderSavedOpps() {
    const saved = app.profile.savedOpponents || [];
    const box = $('#wkSavedOpps');
    if (!box) return;
    if (!saved.length) { box.innerHTML = '<p class="tiny muted" style="margin:4px 0">還沒有儲存的對手 Roster。輸入對手球員後按「儲存此對手」。</p>'; return; }
    box.innerHTML = '<div class="saved-opps-bar">'
      + '<span class="tiny muted" style="white-space:nowrap">已儲存：</span>'
      + saved.map((o) => `<button class="opp-chip" data-load="${esc(o.id)}" title="載入 ${esc(o.name)}（${o.players.length}人）" data-testid="load-opp-${esc(o.name)}">${esc(o.name)} <span class="dim">${o.players.length}人</span></button>`).join('')
      + saved.map((o) => `<button class="icon-btn opp-rm" data-rm-opp="${esc(o.id)}" title="刪除 ${esc(o.name)}" aria-label="刪除 ${esc(o.name)}" style="width:22px;height:22px;font-size:11px">×</button>`).join('')
      + '</div>';
  }

  function render() {
    const p = app.profile; const wb = p.weeklyBasis; const wctx = app.weeklyCtx();
    sel.value = String(p.week);
    renderBasisBtns();

    // use the weekly-specific basis for player stats
    const wUniverse = app.repo.universe(wb);
    const wByName = new Map((wUniverse?.players ?? []).map((x) => [x.name, x]));
    const wPlayer = (name) => wByName.get(name) || app.playerByName(name);
    const mineP = p.selected.map(wPlayer).filter(Boolean);
    const oppP  = p.oppSelected.map(wPlayer).filter(Boolean);
    const mine  = teamTotals(mineP, wctx);
    const opp   = teamTotals(oppP, wctx);

    const allNames = [...new Set([...p.selected, ...p.oppSelected])];
    const trendMap = getTrendMap(allNames);

    renderSavedOpps();
    $('#wkMineSub').textContent = `${p.selected.length} 人 · ${mine.totalPG} Player-Games · ${DATA_BASES[wb]?.short || wb}`;
    $('#wkOppSub').textContent  = `${p.oppSelected.length} 人 · ${opp.totalPG} Player-Games`;
    setHtml($('#wkMine'), rosterRows(p.selected, 'me',  wctx, trendMap));
    setHtml($('#wkOpp'),  rosterRows(p.oppSelected, 'opp', wctx, trendMap));
    hydrateAvatars($('#wkMine'), headshots);
    hydrateAvatars($('#wkOpp'), headshots);

    const cats = new Set(p.h2hCategories);
    const rows = h2hRows(mine, opp, cats);
    const hasOpp = oppP.length > 0;
    const live = hasOpp ? rows.filter((r) => isNum(r.a) && isNum(r.b)) : [];
    const rec = h2hRecord(live);

    // summary
    const warn = [];
    const assumed = [...new Set([...mine.flags.assumed, ...opp.flags.assumed])];
    const noStats = [...new Set([...mine.flags.noStats, ...opp.flags.noStats])];
    const hist    = [...new Set([...mine.flags.historical, ...opp.flags.historical])];
    if (assumed.length) warn.push(`${assumed.length} 位球員的球隊找不到賽程，暫以 ${RULES.defaultGames} 場估算：${assumed.join('、')}`);
    if (noStats.length) warn.push(`${noStats.length} 位球員沒有統計資料，未計入預測：${noStats.join('、')}`);
    if (hist.length) warn.push(`使用歷史參考數據（不是本季實績）：${hist.join('、')}`);

    const wbLabel = DATA_BASES[wb]?.label || wb;
    $('#wkSummary').innerHTML = `<div class="row sp"><div class="scoreline" style="margin:0">
      <div><span class="tiny">H2H 預測 · ${WEEKS[p.week][0]} · ${WEEKS[p.week][1]}</span><br><b data-testid="record">${hasOpp && live.length ? `${rec.w}–${rec.l}${rec.t ? '–' + rec.t : ''}` : '—'}</b></div>
      <div><span class="tiny">預測數據基準</span><br><b>${esc(wbLabel)}</b></div>
      <div><span class="tiny">我方 / 對手 Player-Games</span><br><b>${mine.totalPG} <span class="dim">/</span> ${opp.totalPG}</b></div>
      <div><span class="tiny">DD 預估（你 − 對手）</span><br><b>${fmt1(mine.raw.DD)} <span class="dim">vs</span> ${hasOpp ? fmt1(opp.raw.DD) : '—'}</b></div>
    </div></div>
    ${hasOpp ? '' : `<div class="banner info" style="margin:10px 0 0">${icon('info', 16)}<div>先輸入對手 roster，才會有 H2H 勝負預測；目前只顯示你的本週預估總量。</div></div>`}
    ${warn.map((w) => `<div class="banner warn" style="margin:10px 0 0">${icon('alert', 16)}<div>${esc(w)}</div></div>`).join('')}`;

    // table
    const rowDefs = [
      { label: 'FGM/A', info: (t) => `${fmt1(t.raw.FGM)} / ${fmt1(t.raw.FGA)}` }, { label: 'FG%' },
      { label: 'FTM/A', info: (t) => `${fmt1(t.raw.FTM)} / ${fmt1(t.raw.FTA)}` }, { label: 'FT%' }, { label: 'FTM' },
      { label: '3PTM/A', info: (t) => `${fmt1(t.raw.P3M)} / ${fmt1(t.raw.P3A)}` }, { label: '3P%' }, { label: '3PM' },
      { label: 'PTS' }, { label: 'REB' }, { label: 'AST' }, { label: 'STL' }, { label: 'BLK' }, { label: 'TOV' },
      { label: 'DD', show: 'DD（預估）' }, { label: 'A/T' },
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
        <td class="${r && on_ && hasOpp && r.cls === 'win' ? 'good' : ''}">${fmtWeekly(key, a)}</td>
        <td class="${r && on_ && hasOpp && r.cls === 'loss' ? 'bad' : ''}">${hasOpp ? fmtWeekly(key, b) : '—'}</td>
        <td>${gap}</td><td style="min-width:100px">${bar}</td><td class="l">${res}</td></tr>`;
    }).join('');
    setHtml($('#wkTable'), `<table class="tbl"><thead><tr><th class="l">Category</th><th>你</th><th>對手</th><th>差距（你視角）</th><th></th><th class="l">預測</th></tr></thead><tbody>${allRows}</tbody></table>`);

    // strategy
    const st = $('#wkStrategy');
    if (!cats.size) { st.innerHTML = emptyState('尚未選擇 H2H 項目', '請在上方表格勾選要比較的分類。', 'info'); }
    else if (!hasOpp) { st.innerHTML = emptyState('先輸入對手 roster', '有對手後，這裡會整理「主要壓力、最接近翻盤、可以守住」。', 'weekly'); }
    else {
      const S = strategy(live);
      const tags = (arr, n) => arr.slice(0, n).map((x) => `<span class="stag ${x.cls}">${esc(x.label)} ${gapText(x.key, x.gap)}</span>`).join('');
      st.innerHTML = `<div class="strategy">
        <div class="scard loss"><h4>🔴 主要壓力</h4>${S.mainPressure.length ? tags(S.mainPressure, 2) : '<span class="muted">目前沒有明顯落後項目</span>'}<p>落後最多的分類；想改變本週結果，先從這裡找補強方向。</p></div>
        <div class="scard flip"><h4>🟡 最接近翻盤</h4>${S.nearLoss.length ? tags(S.nearLoss, 2) : '<span class="muted">沒有落後但接近的分類</span>'}<p>差距較小的落後分類，比「輸很多」更可能用少量陣容調整翻過來。</p></div>
        <div class="scard win"><h4>🟢 可以守住</h4>${S.strongWins.length ? tags(S.strongWins, 3) : '<span class="muted">目前沒有明顯優勢</span>'}<p>這些項目站在你這邊，不需要為了這場特別犧牲其他分類去追。</p></div>
      </div>
      <div class="scoreline" style="margin-bottom:0"><span><b data-testid="strategy-line">${S.wins.length} 項領先、${S.losses.length} 項落後${S.ties.length ? `、${S.ties.length} 項平手` : ''}</b>${S.nearLoss.length ? `　最值得先觀察：${S.nearLoss.map((x) => esc(x.label)).join('、')}` : ''}</span></div>`;

      // pickup panel
      renderPickup(mineP, opp, S.losses.map((r) => r.label), wctx, p.h2hCategories);
    }
    if (!hasOpp) $('#wkPickup').innerHTML = emptyState('先輸入對手 roster', '輸入對手後，這裡會推薦最能翻轉落後分類的自由球員。', 'star');
    void fmt2; void pct;
  }

  on(root, 'click', '[data-basis]', (e, t) => { if (!t.disabled) app.setWeeklyBasis(t.dataset.basis); });
  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act; const n = t.dataset.name;
    if (a === 'wk-prev') app.setWeek(app.profile.week - 1);
    else if (a === 'wk-next') app.setWeek(app.profile.week + 1);
    else if (a === 'add-me') ctx.quickAdd.open('me');
    else if (a === 'add-opp') ctx.quickAdd.open('opp');
    else if (a === 'clear-opp') app.clearOpp();
    else if (a === 'save-opp') {
      const opp = app.profile.oppSelected;
      if (!opp.length) { import('../components/toast.js').then(({ toast }) => toast('請先新增對手球員', { level: 'warn' })); return; }
      const name = window.prompt(`為這組對手 Roster（${opp.length}人）取個名字：`);
      if (!name?.trim()) return;
      const r = app.saveOppRoster(name, opp);
      import('../components/toast.js').then(({ toast }) => toast(r.ok ? `已儲存「${r.entry.name}」` : r.error, { level: r.ok ? 'ok' : 'warn' }));
    }
    else if (a === 'rm-opp') app.removeOpp(n);
    else if (a === 'rm-me') app.removePlayer(n);
    else if (a === 'add') { app.addPlayer(n); import('../components/toast.js').then(({ toast }) => toast(`已加入我的球隊：${n}`, { level: 'ok' })); }
    else if (a === 'g-inc' || a === 'g-dec') { const cur = projectedGames(app.playerByName(n), app.weeklyCtx()).games; app.setGames(n, cur + (a === 'g-inc' ? 1 : -1)); }
    else if (a === 'g-reset') app.setGames(n, null);
  });
  on(root, 'change', '[data-h2h]', (e, t) => app.toggleH2H(t.dataset.h2h, t.checked));
  on(root, 'click', '[data-detail]', (e, t) => ctx.showPlayer(t.dataset.detail));
  on(root, 'click', '[data-load]', (e, t) => {
    const r = app.loadOppRoster(t.dataset.load);
    if (!r.ok) import('../components/toast.js').then(({ toast }) => toast(r.error, { level: 'warn' }));
  });
  on(root, 'click', '[data-rm-opp]', (e, t) => { app.deleteOppRoster(t.dataset.rmOpp); });

  return { id: 'weekly', topics: ['roster', 'opp', 'week', 'games', 'teams', 'h2h', 'league', 'settings', 'weights', 'data'], render };
}
void debounce;
