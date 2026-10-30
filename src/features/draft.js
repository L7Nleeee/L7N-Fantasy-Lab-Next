// ① Draft & Candidate Fit: team pulse, category strength, roster stats, What-if simulator, Candidate Fit board.
import { $, esc, on, setHtml, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { STAT_COLUMNS, RULES, DATA_BASES } from '../engine/schema.js';
import { baseFit, teamFit, fitIndex, fitTone, hasFit, strengthSummary, cellTone } from '../engine/model.js';
import { projectedGames, teamTotals } from '../engine/weekly.js';
import { simulate, WHATIF_MAX } from '../engine/whatif.js';
import { buildSearchIndex, searchPlayers } from '../engine/search.js';
import { fmt1, fmtStat, signed, fmtWeekly } from '../ui/format.js';
import { strengthBar, emptyState, badge } from '../components/badges.js';
import { radarSvg, strengthToAxes } from '../components/radar.js';
import { statCells, statHeads, rowClass, playerCell } from '../components/statcells.js';
import { avatarHtml, hydrateAvatars } from '../components/avatar.js';
import { toast } from '../components/toast.js';
import { WEEKS } from '../data/static/schedule.js';
import { TEAMS } from '../data/static/teams.js';
import { isNum } from '../engine/util.js';
import { h2hRows, h2hRecord } from '../engine/weekly.js';

const SORT_COLS = [['pts', 'PTS/G'], ['3pm', '3PM/G'], ['ftm', 'FTM/G'], ['reb', 'REB/G'], ['ast', 'AST/G'], ['stl', 'STL/G'], ['blk', 'BLK/G'], ['fg', 'FG%'], ['ft', 'FT%'], ['tov', 'TOV/G']];
const SORT_LABEL = { yahoo: 'Yahoo Rank', myrank: '我的順位', teamfit: 'Team Fit', basefit: 'Base Fit', pts: 'PTS/G', '3pm': '3PM/G', ftm: 'FTM/G', reb: 'REB/G', ast: 'AST/G', stl: 'STL/G', blk: 'BLK/G', fg: 'FG%', ft: 'FT%', tov: 'TOV/G', dd: 'DD', at: 'A/T', '3p': '3P%' };
const FIELD = { pts: 'pts', '3pm': 'pm3', ftm: 'ftm', reb: 'reb', ast: 'ast', stl: 'stl', blk: 'blk', fg: 'fg', ft: 'ft', tov: 'tov', dd: 'dd', at: 'at', '3p': 'p3' };

export function createDraftView(ctx) {
  const { app, headshots } = ctx;
  const root = document.getElementById('view-draft');
  root.innerHTML = `
<div class="pulse-cards" id="dPulse"></div>
<div class="panel section"><div class="panel-h"><h3>分類強弱 <span class="sub">50 = 參考池中性 · 越高越強</span></h3><span class="sub" id="dHint"></span></div><div class="panel-b"><div class="advice" id="dAdvice"></div><div class="sgrid" id="dStrength"></div></div></div>
<div class="panel section"><div class="panel-h"><h3>我的球隊 <span class="sub" id="dRosterSub"></span></h3><div class="row"><button class="btn small primary" data-act="open-search" data-testid="add-player">${icon('plus', 14)}新增球員</button><button class="btn small" data-act="clear-roster" data-testid="clear-roster">清空</button></div></div><div class="tbl-wrap mid" id="dRoster" data-testid="roster-table"></div><p class="sec-note" id="dRosterNote"></p></div>
<div class="panel section" id="dWhatifPanel"><div class="panel-h"><h3>What-if <span class="sub">加入／移除球員模擬（最多各 ${WHATIF_MAX} 人，不會改動正式 roster）</span></h3><button class="btn small" data-act="wi-clear" id="wiClear" data-testid="wi-clear">清除模擬</button></div>
 <div class="panel-b"><div class="wi-grid"><div><div class="wi-lbl">想移除 <span id="wiOutN"></span></div><div class="chips" id="wiOut"></div></div>
 <div><div class="wi-lbl">想加入 <span id="wiInN"></span></div><div class="pos-rel"><input class="inp" id="wiSearch" data-testid="wi-search" placeholder="輸入球員姓名，例如 Mark / Doncic" autocomplete="off"><div class="dropdown" id="wiResults" hidden></div></div><div class="chips" id="wiIn" style="margin-top:8px"></div></div></div>
 <div id="wiOut2" style="margin-top:12px" data-testid="wi-summary"></div></div></div>
<div class="panel section"><div class="panel-h"><h3>Candidate Fit <span class="sub">適合球隊的候選球員 · Yahoo Rank 導航 + L7N Fit</span></h3><span class="sub" id="cStatus"></span></div>
 <div class="toolbar"><div class="grow"><input class="inp" id="cSearch" data-testid="cand-search" placeholder="搜尋姓名、球隊或 Yahoo 名次" autocomplete="off"></div>
  <select class="inp" id="cSort" style="width:auto" data-testid="cand-sort" aria-label="候選排序"></select>
  <label class="check"><input type="checkbox" id="cAvail" data-testid="cand-avail"> 只看可選球員</label><button class="btn small" data-act="clear-marks" data-testid="clear-marks">清除標記</button><button class="btn small ghost" data-act="clear-search">清除搜尋</button></div>
 <div id="dCand"></div></div>`;

  let candLimit = 40; let search = ''; let idx = null; let idxKey = '';
  const index = () => { const k = `${app.repo.revision}|${app.profile.dataBasis}`; if (k !== idxKey) { idx = buildSearchIndex(app.universe().players); idxKey = k; } return idx; };

  // ---------- pulse + strength ----------
  function renderPulse(m, team) {
    const p = app.profile; const wctx = app.weeklyCtx(); const n = team.length;
    const avg = (k) => (n ? fmt1(team.filter((x) => isNum(x[k])).reduce((s, x) => s + x[k], 0) / Math.max(1, team.filter((x) => isNum(x[k])).length)) : '—');
    const pg = team.reduce((s, x) => s + projectedGames(x, wctx).games, 0);
    const u = app.universe();
    const cards = [['球員數', n], ['平均 PTS/G', avg('pts')], ['平均 REB/G', avg('reb')], ['平均 AST/G', avg('ast')], ['平均 FTM/G', avg('ftm')], [`本週 Player-Games（${WEEKS[p.week][0]}）`, pg], ['參考池', m.status.ok ? `${m.pool.length} 人` : '不可用']];
    $('#dPulse').innerHTML = cards.map(([l, v]) => `<div class="metric"><b>${v}</b><span>${esc(l)}</span></div>`).join('');
    void u;
  }
  function renderStrength(m, team) {
    const box = $('#dStrength');
    if (!m.status.ok) { $('#dHint').textContent = ''; $('#dAdvice').innerHTML = ''; box.innerHTML = `<div class="radar-unavail">${emptyState('分類強弱暫不可用', m.status.reason, 'alert')}</div>`; return; }
    const sum = strengthSummary(m);
    $('#dHint').textContent = team.length ? '' : '先選球員';
    $('#dAdvice').innerHTML = !team.length ? `<span class="hint-chip">${icon('info', 14)}加入球員後，這裡會顯示最該補強的分類</span>`
      : [
          ...(sum.weak.length ? sum.weak.map((c) => `<span class="cat-pill pill-weak">↑ ${c}</span>`) : ['<span class="hint-chip">無明顯弱項</span>']),
          ...(sum.strong.length ? sum.strong.map((c) => `<span class="cat-pill pill-strong">✓ ${c}</span>`) : []),
        ].join('');
    // radar chart + detail bars side by side on desktop, stacked on mobile
    const axes = strengthToAxes(sum.entries);
    const notes = { TOV: '低失誤視為優勢', DD: '以 DD/G 計分，避免 GP 偏差' };
    box.innerHTML = `<div class="radar-layout">
      <div class="radar-chart-wrap" aria-hidden="true">${radarSvg(axes, { size: 340, animated: true })}</div>
      <div class="sgrid radar-compact">${sum.entries.map((e) => strengthBar(e, notes[e.k] || '')).join('')}</div>
    </div>`;
  }

  // ---------- roster ----------
  function renderRoster(m, team) {
    const p = app.profile; const wctx = app.weeklyCtx();
    const el = $('#dRoster');
    $('#dRosterSub').textContent = `${p.selected.length} 人 · ${DATA_BASES[app.universe().used === 'seed' ? 'last' : app.universe().used].label}`;
    if (!p.selected.length) { el.innerHTML = emptyState('還沒有球員', '按「新增球員」或在 Candidate Fit 直接加入。每位球員的個人數據與本週場次會顯示在這裡。', 'draft'); $('#dRosterNote').textContent = ''; return; }
    const rows = p.selected.map((name) => {
      const pl = app.playerByName(name);
      if (!pl) return `<tr><td class="l stick s0 s-edge"><span class="muted">${esc(name)}</span> ${badge('資料中找不到', 'amber')}</td><td colspan="${STAT_COLUMNS.length + 1}" class="l dim">這位球員不在目前的資料集中（不會被刪除）。</td><td class="c"><button class="icon-btn" data-act="rm" data-name="${esc(name)}" aria-label="移除">${icon('close', 16)}</button></td></tr>`;
      const g = projectedGames(pl, wctx); const tm = g.team;
      const stepCls = g.source === 'override' ? 'ov' : g.source === 'assumed' ? 'as' : '';
      return `<tr class="${rowClass(pl)}" data-name="${esc(pl.name)}"><td class="l stick s0 s-edge">${playerCell(pl, { team: tm })}</td>
<td class="c games-cell"><span class="stepper sm ${stepCls}" title="${g.source === 'assumed' ? '賽程未知，暫以 3 場估算' : g.source === 'override' ? '已手動調整（點 ↺ 還原賽程）' : '依 NBA 賽程'}"><button data-act="g-dec" data-name="${esc(pl.name)}" aria-label="減少場次">−</button><b data-testid="games-${esc(pl.name)}">${g.games}</b><button data-act="g-inc" data-name="${esc(pl.name)}" aria-label="增加場次">+</button></span>${g.source === 'override' ? `<button class="icon-btn" style="width:24px;height:24px" data-act="g-reset" data-name="${esc(pl.name)}" title="還原賽程場次" aria-label="還原">↺</button>` : ''}${g.source === 'assumed' ? ' <span class="badge b-amber">?</span>' : ''}</td>
${statCells(pl, m)}<td class="c"><button class="icon-btn" data-act="rm" data-name="${esc(pl.name)}" aria-label="移除 ${esc(pl.name)}" data-testid="rm-${esc(pl.name)}">${icon('close', 16)}</button></td></tr>`;
    }).join('');
    setHtml(el, `<table class="tbl"><thead><tr><th class="l stick s0 s-edge">Player</th><th class="c">本週場次</th>${statHeads()}<th></th></tr></thead><tbody>${rows}</tbody></table>`);
    hydrateAvatars(el, headshots);
    const tot = teamTotals(team, wctx); const fl = tot.flags;
    const notes = [];
    if (fl.assumed.length) notes.push(`${fl.assumed.length} 位球員的球隊找不到賽程，暫以 ${RULES.defaultGames} 場估算（${fl.assumed.join('、')}）`);
    if (fl.noStats.length) notes.push(`${fl.noStats.length} 位沒有統計資料，未計入週預測（${fl.noStats.join('、')}）`);
    if (fl.historical.length) notes.push(`歷史參考：${fl.historical.join('、')}`);
    $('#dRosterNote').innerHTML = (notes.length ? esc(notes.join('｜')) + '<br>' : '') + '這是「球員本身」的資料，不是整隊總和。DD、TD 為球季總數；DD 計分、TD 不計分。綠＝相對優勢、紅＝相對弱勢（依目前資料基準與分類方向）。';
  }

  // ---------- what-if ----------
  function renderWhatif(m, team) {
    const p = app.profile; const wctx = app.weeklyCtx();
    const inP = app.rosterPlayers(p.whatIn).filter((x) => !p.selected.includes(x.name));
    const outP = p.whatOut.filter((n) => p.selected.includes(n));
    $('#wiOutN').textContent = `${outP.length} / ${WHATIF_MAX}`; $('#wiInN').textContent = `${inP.length} / ${WHATIF_MAX}`;
    $('#wiOut').innerHTML = p.selected.length ? p.selected.map((n) => `<button class="chipx ${outP.includes(n) ? 'out' : ''}" data-act="wi-out" data-name="${esc(n)}" data-testid="wi-out-${esc(n)}">${outP.includes(n) ? '✓ ' : ''}${esc(n)} ×</button>`).join('') : '<span class="muted">先加入球員，才能模擬移除</span>';
    $('#wiIn').innerHTML = inP.length ? inP.map((x) => `<span class="chipx in">✓ ${esc(x.name)}<button data-act="wi-in" data-name="${esc(x.name)}" aria-label="取消 ${esc(x.name)}">×</button></span>`).join('') : '<span class="muted">尚未選擇候選人（可搜尋，或在下方 Candidate Fit 點「模擬」）</span>';
    $('#wiClear').hidden = !(inP.length || outP.length);
    const out = $('#wiOut2');
    if (!inP.length && !outP.length) { out.innerHTML = '<p class="tiny" style="margin:0">What-if 只做模擬，不會改變你的正式 roster。選擇後會顯示本週數據、分類強弱與 H2H 勝負的前後變化。</p>'; return; }
    const oppP = app.rosterPlayers(p.oppSelected);
    const sim = simulate({ team: app.rosterPlayers(p.selected), whatIn: inP, whatOut: outP, weeklyCtx: wctx, model: m, oppPlayers: oppP, h2hCats: new Set(p.h2hCategories) });
    let h = '';
    if (sim.record) h += `<div class="scoreline"><div><span class="tiny">H2H 預測（${WEEKS[p.week][0]}）</span><br><b>${sim.record.before.w}–${sim.record.before.l}${sim.record.before.t ? '–' + sim.record.before.t : ''} → ${sim.record.after.w}–${sim.record.after.l}${sim.record.after.t ? '–' + sim.record.after.t : ''}</b></div><div><span class="tiny">預測勝場變化</span><br><b class="${sim.record.delta >= 0 ? 'good-t' : 'bad-t'}">${sim.record.delta >= 0 ? '+' : ''}${sim.record.delta}</b></div></div>`;
    else h += '<div class="banner info">' + icon('info', 16) + '<div>尚未輸入對手 roster，先顯示本週數據變化；到 Weekly H2H 加入對手後，這裡會補上 H2H 勝負變化。</div></div>';
    if (m.status.ok) {
      const ch = Object.keys(sim.strengthAfter).map((k) => ({ k, b: sim.strengthBefore[k]?.index ?? 50, a: sim.strengthAfter[k]?.index ?? 50 })).map((x) => ({ ...x, d: x.a - x.b })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
      h += `<div class="tiny" style="margin:6px 0 2px">分類強弱變化（Strength Index，影響最大的 5 項）</div><div class="chips">${ch.map((x) => `<span class="chipx ${x.d >= 0 ? 'in' : 'out'}" style="padding:0 10px">${esc(x.k)} ${x.b.toFixed(0)} → ${x.a.toFixed(0)} <b>${signed(x.d, 0)}</b></span>`).join('')}</div>`;
    }
    h += '<div style="margin-top:10px">' + sim.deltas.map((d) => {
      const pctKey = ['FG', 'FT', 'P3'].includes(d.k); const scale = pctKey ? 400 : 4;
      const w = Math.min(50, Math.abs(d.diff) * scale); const good = d.k === 'TOV' ? d.diff <= 0 : d.diff >= 0;
      return `<div class="delta-row"><span>${d.k}</span><div class="delta-bar"><i class="${good ? 'pos' : 'neg'}" style="${good ? 'left:50%' : 'right:50%'};width:${w}%"></i></div><b class="${good ? 'good-t' : 'bad-t'}">${fmtWeekly(d.k, d.before)} → ${fmtWeekly(d.k, d.after)} (${d.diff >= 0 ? '+' : ''}${pctKey ? (d.diff * 100).toFixed(1) + '%' : d.k === 'AT' ? d.diff.toFixed(2) : d.diff.toFixed(1)})</b></div>`;
    }).join('') + '</div>';
    out.innerHTML = h;
  }

  // ---------- candidates ----------
  function candRows(m, team) {
    const p = app.profile; const u = app.universe();
    const sel = new Set(p.selected); const marks = new Set(p.draftUnavailable); const myrank = new Map(p.myRank.map((n, i) => [n, i + 1]));
    let pool = search.trim() ? searchPlayers(index(), search, { limit: 400, filter: (x) => !sel.has(x.name) }) : u.players.filter((x) => !sel.has(x.name));
    let rows = pool.map((x) => {
      const ok = hasFit(x, m);
      return { p: x, base: ok ? fitIndex(baseFit(x, m)) : null, tf: ok ? fitIndex(teamFit(x, m)) : null, avail: !marks.has(x.name), my: myrank.get(x.name) ?? null };
    });
    if (p.candAvailableOnly) rows = rows.filter((r) => r.avail);
    const key = p.candSort;
    const val = (r) => { const x = r.p; switch (key) { case 'yahoo': return x.yahooRank ?? 9999; case 'myrank': return r.my ?? 9999; case 'teamfit': return r.tf; case 'basefit': return r.base; default: return x[FIELD[key]]; } };
    const asc = key === 'yahoo' || key === 'myrank';
    if (!(search.trim() && key === 'yahoo' && false)) rows.sort((a, b) => {
      const x = val(a); const y = val(b);
      if (asc) return (x - y) || ((a.p.yahooRank ?? 9999) - (b.p.yahooRank ?? 9999));
      const xn = isNum(x) ? x : -Infinity; const yn = isNum(y) ? y : -Infinity;
      return key === 'tov' ? ((isNum(x) ? x : Infinity) - (isNum(y) ? y : Infinity)) : yn - xn;
    });
    return { rows, marks };
  }
  function fitPill(v) { return v === null ? '<span class="fit na">—</span>' : `<span class="fit ${fitTone(v)}" data-testid="fit">${v.toFixed(0)}</span>`; }

  function renderCandidates(m, team) {
    const p = app.profile; const { rows, marks } = candRows(m, team);
    const shown = rows.slice(0, candLimit);
    $('#cStatus').textContent = `${p.candAvailableOnly ? '可選' : '候選池'} ${rows.length} 人｜暫標已選走 ${marks.size} 人`;
    const mobile = window.matchMedia('(max-width: 820px)').matches;
    const head = (k, label, cls = '') => `<th class="sortable ${p.candSort === k ? 'active' : ''} ${cls}" data-act="sort" data-key="${k}" data-testid="sort-${k}">${label}<span class="arr">${p.candSort === k ? (k === 'yahoo' || k === 'myrank' ? '↑' : '↓') : '↕'}</span></th>`;
    const wrap = $('#dCand');
    if (!rows.length) { wrap.innerHTML = emptyState('沒有符合的候選球員', search.trim() ? '這不代表球員不存在：可能是資料中尚未收錄或名字拼法不同。' : '請調整篩選條件。', 'players'); return; }
    const more = rows.length > shown.length ? `<div class="more-row"><button class="btn" data-act="more" data-testid="cand-more">顯示更多（${shown.length} / ${rows.length}）</button></div>` : '';
    if (mobile) {
      wrap.innerHTML = '<div class="cand-cards">' + shown.map((r) => {
        const x = r.p; const out = !r.avail;
        const cs = [['pts', 'PTS', 'PTS'], ['pm3', '3PM', '3PM'], ['reb', 'REB', 'REB'], ['ast', 'AST', 'AST'], ['stl', 'STL', 'STL'], ['blk', 'BLK', 'BLK'], ['tov', 'TOV', 'TOV']].map(([f, l, c]) => `<div class="cs ${cellTone(m, x, c) === 'good' ? 'good' : cellTone(m, x, c) === 'bad' ? 'bad' : ''}"><small>${l}</small>${fmt1(x[f])}</div>`).join('');
        return `<article class="ccard ${out ? 'is-out' : ''}" data-name="${esc(x.name)}"><div class="ccard-top">${avatarHtml(x, 'md')}<div class="grow"><button class="plink" data-detail="${esc(x.name)}"><span class="nm">${esc(x.name)}</span></button><span class="psub">${esc(TEAMS[app.effectiveTeam(x)] || app.effectiveTeam(x))} · Yahoo ${x.yahooRank ? '#' + x.yahooRank : '—'}${r.my ? ' · 我的 #' + r.my : ''}</span></div>${fitPill(r.tf)}</div>
<div class="ccard-fits"><span>Base ${r.base === null ? '—' : r.base.toFixed(0)}</span>${x.isRookie ? badge('ROOKIE', 'violet') : ''}${statusBadge2(x)}</div><div class="cstats">${cs}</div>
<div class="ccard-acts"><button class="btn small primary" data-act="add" data-name="${esc(x.name)}">${icon('plus', 14)}加入球隊</button><button class="btn small" data-act="wi-in" data-name="${esc(x.name)}">模擬</button><button class="btn small ghost" data-act="mark" data-name="${esc(x.name)}">${out ? '取消標記' : '已被選'}</button></div></article>`;
      }).join('') + '</div>' + more;
    } else {
      const body = shown.map((r) => {
        const x = r.p; const out = !r.avail; const inWi = p.whatIn.includes(x.name);
        return `<tr class="${out ? 'is-out' : ''} ${rowClass(x)}" data-name="${esc(x.name)}"><td class="stick s0 c"><span class="rank-pill">${x.yahooRank ?? '—'}</span></td><td class="l stick s-edge" style="left:58px">${playerCell(x, { team: app.effectiveTeam(x) })}</td>
<td class="l"><button class="btn small primary" data-act="add" data-name="${esc(x.name)}" data-testid="cand-add">${icon('plus', 13)}加入</button> <button class="btn small ${inWi ? 'primary' : ''}" data-act="wi-in" data-name="${esc(x.name)}" data-testid="cand-whatif">${inWi ? '✓ 模擬中' : '模擬'}</button> <button class="btn small ghost" data-act="mark" data-name="${esc(x.name)}" data-testid="cand-mark" title="標記為已被其他人選走">${out ? '↺ 取消' : '已被選'}</button></td>
<td class="c">${r.my ? '#' + r.my : '—'}</td><td class="c">${fitPill(r.base)}</td><td class="c">${fitPill(r.tf)}</td>${statCells(x, m)}</tr>`;
      }).join('');
      wrap.innerHTML = `<div class="tbl-wrap tall"><table class="tbl" data-testid="cand-table"><thead><tr>${head('yahoo', 'Yahoo', 'stick s0 c')}<th class="l stick s-edge" style="left:58px">Player</th><th class="l">操作</th>${head('myrank', '我的順位', 'c')}${head('basefit', 'Base Fit', 'c')}${head('teamfit', 'Team Fit', 'c')}${head('pts', 'PTS/G')}${head('3pm', '3PM/G')}${head('ftm', 'FTM/G')}${head('reb', 'REB/G')}${head('ast', 'AST/G')}${head('stl', 'STL/G')}${head('blk', 'BLK/G')}${head('fg', 'FG%')}${head('ft', 'FT%')}${head('tov', 'TOV/G')}${head('dd', 'DD（季）')}<th>TD（季）</th>${head('at', 'A/T')}${head('3p', '3P%')}</tr></thead><tbody>${body}</tbody></table>${more}</div>`;
    }
    hydrateAvatars(wrap, headshots);
  }
  const statusBadge2 = (x) => (x.status === 'projection' ? badge('估算', 'violet') : x.status === 'historical' ? badge('歷史', 'amber') : x.status === 'no-data' || x.status === 'no-current' ? badge('無統計', 'muted') : '');

  // ---------- events ----------
  const sigs = {};
  const memo = (k, sig, fn) => { if (sigs[k] === sig) return; sigs[k] = sig; fn(); };
  const mqMobile = window.matchMedia('(max-width: 820px)');
  const rerenderCands = () => { sigs.cand = null; const m = app.model(); renderCandidates(m, m.team); };
  const onSearch = debounce(() => rerenderCands(), 85);
  $('#cSearch').addEventListener('input', (e) => { search = e.target.value; candLimit = 40; onSearch(); });
  $('#cSort').addEventListener('change', (e) => { app.setCandSort(e.target.value); });
  $('#cAvail').addEventListener('change', (e) => app.setAvailableOnly(e.target.checked));
  const wiSearchRender = () => {
    const q = $('#wiSearch').value; const box = $('#wiResults'); const p = app.profile;
    if (!q.trim()) { box.hidden = true; box.innerHTML = ''; return; }
    const rows = searchPlayers(index(), q, { limit: 8, filter: (x) => !p.selected.includes(x.name) && !p.oppSelected.includes(x.name) && !p.whatIn.includes(x.name) });
    box.innerHTML = rows.length ? rows.map((x) => `<div class="qa-row" data-act="wi-in" data-name="${esc(x.name)}" data-testid="wi-result">${avatarHtml(x, 'sm')}<div class="qa-main"><div class="qa-name">${esc(x.name)}</div><div class="qa-sub">${esc(TEAMS[app.effectiveTeam(x)] || app.effectiveTeam(x))} · PTS ${fmt1(x.pts)} · AST ${fmt1(x.ast)} · REB ${fmt1(x.reb)}</div></div><span class="btn small">加入</span></div>`).join('') : '<div class="muted" style="padding:10px">找不到符合的球員</div>';
    box.hidden = false; hydrateAvatars(box, headshots);
  };
  $('#wiSearch').addEventListener('input', debounce(wiSearchRender, 70));
  $('#wiSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; wiSearchRender(); } else if (e.key === 'Enter') { const f = $('#wiResults [data-act="wi-in"]'); if (f) { e.preventDefault(); f.click(); } } });
  document.addEventListener('click', (e) => { if (!e.target.closest('#wiSearch,#wiResults')) $('#wiResults').hidden = true; });

  on(root, 'click', '[data-act]', (e, t) => {
    const a = t.dataset.act; const n = t.dataset.name;
    if (a === 'open-search') ctx.quickAdd.open('me');
    else if (a === 'clear-roster') { if (app.profile.selected.length) { app.clearRoster(); toast('已清空我的球隊', { level: 'warn' }); } }
    else if (a === 'rm') app.removePlayer(n);
    else if (a === 'add') { app.addPlayer(n); toast(`已加入我的球隊：${n}`, { level: 'ok' }); }
    else if (a === 'wi-in') { const r = app.toggleWhatIn(n); if (!r.ok) toast(r.error, { level: 'warn' }); $('#wiResults').hidden = true; $('#wiSearch').value = ''; }
    else if (a === 'wi-out') { const r = app.toggleWhatOut(n); if (!r.ok) toast(r.error, { level: 'warn' }); }
    else if (a === 'wi-clear') app.clearWhatIf();
    else if (a === 'mark') app.toggleUnavailable(n);
    else if (a === 'clear-marks') app.clearUnavailable();
    else if (a === 'clear-search') { search = ''; $('#cSearch').value = ''; rerenderCands(); }
    else if (a === 'sort') app.setCandSort(t.dataset.key);
    else if (a === 'more') { candLimit += 60; rerenderCands(); }
    else if (a === 'g-inc' || a === 'g-dec') { const pl = app.playerByName(n); const cur = projectedGames(pl, app.weeklyCtx()).games; app.setGames(n, cur + (a === 'g-inc' ? 1 : -1)); }
    else if (a === 'g-reset') app.setGames(n, null);
  });
  on(root, 'click', '[data-detail]', (e, t) => ctx.showPlayer(t.dataset.detail));
  mqMobile.addEventListener?.('change', () => { if (!root.hidden) rerenderCands(); });

  return {
    id: 'draft', topics: ['roster', 'weights', 'settings', 'week', 'games', 'teams', 'myrank', 'marks', 'candui', 'what', 'opp', 'h2h', 'league'],
    render() {
      const m = app.model(); const p = app.profile;
      const team = app.rosterPlayers(p.selected);
      const sel = $('#cSort');
      if (!sel.dataset.ready) { sel.innerHTML = Object.entries(SORT_LABEL).map(([k, l]) => `<option value="${k}">排序：${l}</option>`).join(''); sel.dataset.ready = '1'; }
      sel.value = p.candSort; $('#cAvail').checked = p.candAvailableOnly;
      // Sections re-render only when their own inputs changed (e.g. stepping games never rebuilds the 500-row candidate board).
      const msig = `${app.repo.revision}|${p.dataBasis}|${p.minGP}|${p.refMode}|${JSON.stringify(p.weights)}|photos:${app.settings.photos !== false}`;
      const rost = p.selected.join('|'); const tov = JSON.stringify(p.teamOverrides); const gm = JSON.stringify(p.overrides);
      memo('pulse', `${msig}#${rost}#${p.week}#${tov}#${gm}`, () => renderPulse(m, team));
      memo('strength', `${msig}#${rost}`, () => renderStrength(m, team));
      memo('roster', `${msig}#${rost}#${p.week}#${tov}#${gm}`, () => renderRoster(m, team));
      memo('what', `${msig}#${rost}#${p.whatIn}#${p.whatOut}#${p.oppSelected}#${p.h2hCategories}#${p.week}#${tov}#${gm}`, () => renderWhatif(m, team));
      memo('cand', `${msig}#${rost}#${p.candSort}#${p.candAvailableOnly}#${p.draftUnavailable}#${p.myRank}#${p.whatIn}#${tov}#${search}#${candLimit}#${mqMobile.matches}`, () => renderCandidates(m, team));
    },
  };
}
void SORT_COLS; void fmtStat; void h2hRows; void h2hRecord;
