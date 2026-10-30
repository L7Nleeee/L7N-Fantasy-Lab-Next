// Weekly H2H History v2 — record results + full weekly stats, view trends and detail.
import { $, esc, on, setHtml } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { loadHistory, saveHistory, getLeagueMatches, addMatch, deleteMatch,
         analyzeHistory, buildActualDataset, STAT_LABELS, PCT_LABELS, REVERSE_LABELS } from '../state/history.js';
import { winSparkline, catBarChart } from '../components/sparkline.js';
import { emptyState, badge } from '../components/badges.js';
import { askConfirm } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { WEEKS } from '../data/static/schedule.js';
import { DEFAULT_H2H_CATS } from '../engine/schema.js';
import { fmt1, fmt2, pct } from '../ui/format.js';

const RESULT_LABEL = { W: '勝', L: '敗', T: '和局' };
const RESULT_CLS   = { W: 'good-t', L: 'bad-t', T: 'muted' };
const f = (v, label) => v == null ? '—' : PCT_LABELS.has(label) ? (Number(v)*100).toFixed(1)+'%' : Number(v).toFixed(PCT_LABELS.has(label) ? 3 : 1);

export function createHistoryView(ctx) {
  const { app } = ctx;
  const root = document.getElementById('view-history');
  let detailId = null;   // currently open match detail
  // Detail overlay — appended to body so position:fixed is not clipped by .panel{contain}
  const overlay = document.createElement('div');
  overlay.id = 'hDetailOverlay';
  overlay.hidden = true;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(2,4,20,.88);overflow-y:auto;backdrop-filter:blur(4px)';
  const detailWrap = document.createElement('div');
  detailWrap.style.cssText = 'max-width:680px;margin:40px auto;padding:0 16px 80px';
  const detailBox = document.createElement('div');
  detailBox.className = 'panel';
  detailBox.id = 'hDetailBox';
  detailWrap.appendChild(detailBox);
  overlay.appendChild(detailWrap);
  document.body.appendChild(overlay);
  // close when clicking the backdrop (not the panel itself)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { detailId=null; detailEditMode=false; Object.keys(detailStatsIn).forEach((k)=>delete detailStatsIn[k]); overlay.hidden=true; } });

  root.innerHTML = `
<div class="panel section">
  <div class="panel-h"><h3>📋 記錄本週對戰結果</h3><span class="sub">每週手動輸入一次，累積後自動分析強弱趨勢</span></div>
  <div class="panel-b" id="hForm">
    <div class="row" style="flex-wrap:wrap;gap:12px;align-items:flex-start">
      <div class="field" style="flex:2;min-width:180px"><label class="lbl">賽週</label><select class="inp" id="hWeekSel">${WEEKS.map((w,i)=>`<option value="${i}">${w[0]} · ${w[1]}</option>`).join('')}</select></div>
      <div class="field" style="flex:2;min-width:160px"><label class="lbl">對手名稱（可省略）</label><input class="inp" id="hOppName" placeholder="對手聯盟名" maxlength="40"></div>
      <div class="field" style="flex:0"><label class="lbl">結果</label>
        <div class="row" style="gap:6px">
          <button class="btn result-btn" data-res="W" data-testid="hres-W">✅ 勝</button>
          <button class="btn result-btn" data-res="L" data-testid="hres-L">❌ 敗</button>
          <button class="btn result-btn" data-res="T" data-testid="hres-T">🤝 和</button>
        </div>
      </div>
    </div>
    <div class="field"><label class="lbl">各分類結果（可選）</label><div class="cat-result-grid" id="hCatGrid"></div></div>
    <div class="panel section" style="margin:14px 0 0;padding:0">
      <div class="panel-h" style="padding:10px 14px 6px;cursor:pointer" id="hStatsToggle">
        <h4 style="margin:0;font-size:13px">📊 本週詳細數據（可選，但填了就能分析你的實際平均值）</h4>
        <span class="sub" id="hStatsToggleIcon">▶ 展開輸入</span>
      </div>
      <div id="hStatsPanel" hidden>
        <div style="padding:0 14px 10px">
          <p class="tiny muted" style="margin:0 0 10px">輸入你這週的實際統計數字（依照你聯盟的計分項目）。填越多，「我的陣容本季實際表現」分析就越準確。</p>
          <div class="stats-entry-grid" id="hStatsGrid"></div>
        </div>
      </div>
    </div>
    <div class="row" style="gap:8px;margin-top:12px">
      <input class="inp" id="hNote" placeholder="備注（可省略）" style="flex:1" maxlength="80">
      <button class="btn primary" id="hSave" data-testid="h-save" disabled>${icon('check',14)}儲存記錄</button>
    </div>
  </div>
</div>
<div class="panel section" id="hAnalysisPanel">
  <div class="panel-h"><h3>📊 勝負趨勢分析</h3><span class="sub" id="hAnalysisSub"></span></div>
  <div class="panel-b" id="hAnalysis"></div>
</div>
<div class="panel section" id="hActualPanel" hidden>
  <div class="panel-h"><h3>🏀 我的陣容本季實際平均</h3><span class="sub" id="hActualSub"></span></div>
  <div class="panel-b" id="hActual"></div>
</div>
<div class="panel section">
  <div class="panel-h"><h3>📅 歷史記錄</h3><button class="btn small ghost" data-act="clear-all" data-testid="h-clear-all">清除全部</button></div>
  <div id="hList" data-testid="h-list"></div>
</div>
`;

  let selectedResult = null;
  const catState = {};
  const statsIn = {};    // label -> {my: string, opp: string}
  let statsOpen = false;
  const storage = () => app.storage;
  const allCats = () => [...new Set([...(app.profile.h2hCategories.length ? app.profile.h2hCategories : DEFAULT_H2H_CATS), ...(app.profile.customH2HCats||[])])];
  const allStats = () => [...new Set([...STAT_LABELS, ...(app.profile.customH2HCats||[])])];

  // ---------- cat grid ----------
  function initCatGrid() {
    const cats = allCats();
    const custom = app.profile.customH2HCats || [];
    const cell = (c, isCustom) => `<div class="cat-cell${isCustom?' cat-custom':''}" data-cat="${esc(c)}">
      <span class="cat-label">${esc(c)}${isCustom?`<button class="cat-rm" data-rm="${esc(c)}">×</button>`:''}</span>
      <div class="cat-btns">
        <button class="cat-btn" data-cat="${esc(c)}" data-val="win">W</button>
        <button class="cat-btn" data-cat="${esc(c)}" data-val="tie">-</button>
        <button class="cat-btn" data-cat="${esc(c)}" data-val="loss">L</button>
      </div></div>`;
    $('#hCatGrid').innerHTML = cats.map((c)=>cell(c,custom.includes(c))).join('')
      +`<div class="cat-cell cat-add"><button class="cat-add-btn" data-act="add-cat">＋<span>新增</span></button></div>`;
    cats.forEach((c)=>{ if(!(c in catState)) catState[c]=null; });
    Object.keys(catState).forEach((k)=>{ if(!cats.includes(k)) delete catState[k]; });
    // restore button states
    root.querySelectorAll('.cat-btn').forEach((b)=>{ b.classList.toggle('active', catState[b.dataset.cat]===b.dataset.val); });
  }

  // ---------- stats entry grid ----------
  function initStatsGrid() {
    const labels = allStats();
    labels.forEach((l)=>{ if(!statsIn[l]) statsIn[l]={my:'',opp:''}; });
    $('#hStatsGrid').innerHTML = labels.map((l)=>`
      <div class="stat-entry-row">
        <span class="stat-entry-label">${esc(l)}${REVERSE_LABELS.has(l)?'<span class="tiny muted"> (低佳)</span>':''}</span>
        <input class="inp stat-inp" data-stat="${esc(l)}" data-side="my"  placeholder="我方" value="${esc(statsIn[l]?.my||'')}" inputmode="decimal">
        <input class="inp stat-inp" data-stat="${esc(l)}" data-side="opp" placeholder="對手" value="${esc(statsIn[l]?.opp||'')}" inputmode="decimal">
      </div>`).join('');
  }

  function toggleStats() {
    statsOpen = !statsOpen;
    $('#hStatsPanel').hidden = !statsOpen;
    $('#hStatsToggleIcon').textContent = statsOpen ? '▼ 收起' : '▶ 展開輸入';
    if (statsOpen) initStatsGrid();
  }

  function parseStats() {
    const my = {}; const opp = {};
    for (const [l, v] of Object.entries(statsIn)) {
      const mv = parseFloat(v.my); const ov = parseFloat(v.opp);
      my[l]  = isNaN(mv) ? null : mv;
      opp[l] = isNaN(ov) ? null : ov;
    }
    return { my, opp };
  }

  function updateSaveBtn() { $('#hSave').disabled = !selectedResult; }

  // ---------- events ----------
  on(root, 'click', '.result-btn', (e,t) => {
    selectedResult = t.dataset.res;
    root.querySelectorAll('.result-btn').forEach((b)=>b.classList.remove('active'));
    t.classList.add('active'); updateSaveBtn();
  });
  on(root, 'click', '.cat-btn', (e,t) => {
    const c=t.dataset.cat; const v=t.dataset.val;
    catState[c] = catState[c]===v ? null : v;
    root.querySelectorAll(`.cat-btn[data-cat="${CSS.escape(c)}"]`).forEach((b)=>b.classList.toggle('active',b.dataset.val===catState[c]));
  });
  on(root, 'input', '.stat-inp', (e,t) => {
    const l=t.dataset.stat; const side=t.dataset.side;
    if (t.classList.contains('detail-inp')) {
      if (!detailStatsIn[l]) detailStatsIn[l]={my:'',opp:''};
      detailStatsIn[l][side]=t.value;
    } else {
      if (!statsIn[l]) statsIn[l]={my:'',opp:''};
      statsIn[l][side]=t.value;
    }
  });
  $('#hStatsToggle').addEventListener('click', toggleStats);
  on(root, 'click', '.cat-rm', (e,t)=>{ e.stopPropagation(); app.removeCustomCat(t.dataset.rm); initCatGrid(); initStatsGrid(); });
  on(root, 'click', '[data-act="add-cat"]', ()=>{
    const name = window.prompt('輸入新競賽項目名稱（如 T、TD）：');
    if (!name) return;
    const r = app.addCustomCat(name);
    if (!r.ok) { toast(r.error,{level:'warn'}); return; }
    initCatGrid(); initStatsGrid();
  });

  $('#hSave').addEventListener('click', ()=>{
    if (!selectedResult) return;
    const week = Number($('#hWeekSel').value);
    const wl = WEEKS[week];
    const catResults = Object.fromEntries(Object.entries(catState).filter(([,v])=>v));
    const { my, opp } = statsOpen ? parseStats() : { my: null, opp: null };
    const hasStats = my && Object.values(my).some((v)=>v!=null);
    const match = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      week, weekLabel: wl?.[0]??`W${week+1}`, season:'2026-27',
      result: selectedResult,
      score: { w: Object.values(catResults).filter((v)=>v==='win').length, l: Object.values(catResults).filter((v)=>v==='loss').length, t: Object.values(catResults).filter((v)=>v==='tie').length },
      catResults, opponent: $('#hOppName').value.trim()||null, note: $('#hNote').value.trim()||null,
      myStats: hasStats ? my : null, oppStats: hasStats ? opp : null,
      recordedAt: new Date().toISOString(),
    };
    const ok = saveHistory(storage(), addMatch(loadHistory(storage()), app.activeId, match));
    if (!ok.ok) { toast('儲存失敗：'+ok.error,{level:'error'}); return; }
    toast(`第 ${wl?.[0]} 週 ${RESULT_LABEL[selectedResult]} 已記錄${hasStats?' · 含本週數據':''}`,{level:'ok'});
    // reset
    selectedResult=null; root.querySelectorAll('.result-btn').forEach((b)=>b.classList.remove('active'));
    Object.keys(catState).forEach((k)=>{ catState[k]=null; });
    Object.keys(statsIn).forEach((k)=>{ statsIn[k]={my:'',opp:''}; });
    root.querySelectorAll('.cat-btn,.stat-inp').forEach((el)=>{ if(el.classList.contains('cat-btn')) el.classList.remove('active'); else el.value=''; });
    $('#hOppName').value=''; $('#hNote').value=''; updateSaveBtn();
    if (statsOpen) toggleStats();
    render();
  });

  // detail overlay events (delegated on body since overlay is outside root)
  overlay.addEventListener('click', async (e) => {
    const t=e.target.closest('[data-act]'); if (!t) return;
    const a=t.dataset.act;
    if (a==='close-detail') {
      detailId=null; detailEditMode=false; Object.keys(detailStatsIn).forEach((k)=>delete detailStatsIn[k]); overlay.hidden=true;
    } else if (a==='detail-edit-stats') {
      detailEditMode=true; renderDetail();
    } else if (a==='detail-cancel-edit') {
      detailEditMode=false; renderDetail();
    } else if (a==='detail-save-stats') {
      detailBox.querySelectorAll('.detail-inp').forEach((el)=>{
        const l=el.dataset.stat; const side=el.dataset.side;
        if (!detailStatsIn[l]) detailStatsIn[l]={my:'',opp:''};
        detailStatsIn[l][side]=el.value;
      });
      const my={}; const opp={};
      for (const [l,v] of Object.entries(detailStatsIn)) {
        const mv=parseFloat(v.my); const ov=parseFloat(v.opp);
        my[l]=isNaN(mv)?null:mv; opp[l]=isNaN(ov)?null:ov;
      }
      const hasAny = Object.values(my).some((v)=>v!=null);
      const all2=loadHistory(storage()); const matches2=getLeagueMatches(all2,app.activeId);
      const m2=matches2.find((x)=>x.id===detailId); if (!m2) return;
      const updated={...m2, myStats:hasAny?my:m2.myStats, oppStats:hasAny?opp:m2.oppStats};
      const ok=saveHistory(storage(), addMatch(all2, app.activeId, updated));
      if (!ok.ok) { toast('儲存失敗：'+ok.error,{level:'error'}); return; }
      toast('數據已補填並儲存',{level:'ok'});
      detailEditMode=false; Object.keys(detailStatsIn).forEach((k)=>delete detailStatsIn[k]);
      renderDetail(); render();
    }
  });
  overlay.addEventListener('input', (e) => {
    const t=e.target; if (!t.classList.contains('detail-inp')) return;
    const l=t.dataset.stat; const side=t.dataset.side;
    if (!detailStatsIn[l]) detailStatsIn[l]={my:'',opp:''};
    detailStatsIn[l][side]=t.value;
  });

  on(root, 'click', '[data-act]', async (e,t)=>{
    const a=t.dataset.act;
    if (a==='delete-match') {
      if (!await askConfirm({title:'刪除這筆記錄？',ok:'刪除',danger:true})) return;
      saveHistory(storage(), deleteMatch(loadHistory(storage()), app.activeId, t.dataset.id)); render();
    } else if (a==='clear-all') {
      if (!await askConfirm({title:'清除所有歷史記錄？',ok:'清除',danger:true})) return;
      const all=loadHistory(storage()); delete all[app.activeId]; saveHistory(storage(),all); render();
    } else if (a==='open-detail') {
      detailId=t.dataset.id; renderDetail();
    }
  });

  // ---------- detail panel ----------
  // track whether we are in edit-stats mode inside the detail panel
  let detailEditMode = false;
  const detailStatsIn = {};   // label -> {my, opp}

  function renderDetail() {
    const all=loadHistory(storage()); const matches=getLeagueMatches(all,app.activeId);
    const m=matches.find((x)=>x.id===detailId); if (!m) return;
    const hasStats = m.myStats && Object.values(m.myStats).some((v)=>v!=null);
    const allLabels = [...new Set([...Object.keys(m.catResults||{}), ...allStats()])];

    if (detailEditMode) {
      // ---- edit / fill-in mode ----
      allLabels.forEach((l)=>{
        if (!detailStatsIn[l]) detailStatsIn[l]={ my: m.myStats?.[l]!=null?String(m.myStats[l]):'', opp: m.oppStats?.[l]!=null?String(m.oppStats[l]):'' };
      });
      const rows = allLabels.map((l)=>`
        <div class="stat-entry-row">
          <span class="stat-entry-label">${esc(l)}${REVERSE_LABELS.has(l)?'<span class="tiny muted"> (低佳)</span>':''}</span>
          <input class="inp stat-inp detail-inp" data-stat="${esc(l)}" data-side="my"  placeholder="我方" value="${esc(detailStatsIn[l]?.my||'')}" inputmode="decimal">
          <input class="inp stat-inp detail-inp" data-stat="${esc(l)}" data-side="opp" placeholder="對手" value="${esc(detailStatsIn[l]?.opp||'')}" inputmode="decimal">
        </div>`).join('');
      detailBox.innerHTML=`
        <div class="panel-h"><h3>${esc(m.weekLabel)} ${m.opponent?`vs ${esc(m.opponent)}`:''} <span class="sub">補填數據</span></h3><button class="icon-btn" data-act="close-detail" style="margin-left:auto">${icon('close',18)}</button></div>
        <div class="panel-b">
          <div class="row" style="gap:8px;margin-bottom:4px"><span class="tiny muted">每行左欄為我方，右欄為對手。不改的欄位留空或保留原值。</span></div>
          <div class="stats-entry-grid" id="hDetailStatsGrid" style="margin-top:8px">${rows}</div>
          <div class="row" style="gap:8px;margin-top:14px">
            <button class="btn" data-act="detail-cancel-edit">取消</button>
            <button class="btn primary" data-act="detail-save-stats">${icon('check',14)}儲存數據</button>
          </div>
        </div>`;
    } else {
      // ---- read mode ----
      const viewLabels = [...new Set([...Object.keys(m.catResults||{}), ...Object.keys(m.myStats||{}), ...Object.keys(m.oppStats||{})])];
      const rows = viewLabels.map((l)=>{
        const res=m.catResults?.[l]; const mv=m.myStats?.[l]; const ov=m.oppStats?.[l];
        const resCell = res ? `<span class="hcat-tag ${res}">${res==='win'?'W':res==='loss'?'L':'—'}</span>` : '—';
        const mClass = mv!=null&&ov!=null ? (mv>ov?'good':'bad') : '';
        return `<tr><td class="l"><b>${esc(l)}</b></td><td>${resCell}</td><td class="${mClass}">${f(mv,l)}</td><td>${f(ov,l)}</td></tr>`;
      }).join('');
      detailBox.innerHTML=`
        <div class="panel-h">
          <h3>${esc(m.weekLabel)} ${m.opponent?`vs ${esc(m.opponent)}`:''}</h3>
          <div class="row" style="gap:6px;margin-left:auto">
            <button class="btn small" data-act="detail-edit-stats" data-testid="detail-edit-stats">${icon('edit',13)} ${hasStats?'編輯數據':'補填數據'}</button>
            <button class="icon-btn" data-act="close-detail">${icon('close',18)}</button>
          </div>
        </div>
        <div class="panel-b">
          <div class="row" style="gap:16px;margin-bottom:14px">
            <div class="metric"><b class="${RESULT_CLS[m.result]}">${RESULT_LABEL[m.result]}</b><span>結果</span></div>
            ${m.score.w||m.score.l?`<div class="metric"><b>${m.score.w}W–${m.score.l}L${m.score.t?'–'+m.score.t+'T':''}</b><span>分類比分</span></div>`:''}
            <div class="metric"><b>${esc(m.season)}</b><span>賽季</span></div>
          </div>
          ${rows.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="l">項目</th><th>勝負</th><th>我方</th><th>對手</th></tr></thead><tbody>${rows}</tbody></table></div>`:
            `<div class="banner info">${icon('info',15)}<div>這週還沒有填數據。點右上角「補填數據」直接在這裡輸入。</div></div>`}
          ${m.note?`<p class="tiny muted" style="margin-top:10px">備注：${esc(m.note)}</p>`:''}
        </div>`;
    }
    overlay.hidden=false; overlay.scrollTop=0;
  }

  // ---------- actual averages panel ----------
  function renderActual(matches) {
    const ds=buildActualDataset(matches);
    const panel=$('#hActualPanel'); const box=$('#hActual');
    if (!ds) { panel.hidden=true; return; }
    panel.hidden=false;
    $('#hActualSub').textContent=`${ds.weeks} 週有數據 · 以下為你陣容的實際週均值`;
    const labels=Object.keys(ds.avgs).sort();
    box.innerHTML=`<div class="actual-grid">${labels.map((l)=>{
      const v=ds.avgs[l]; const pctLbl=PCT_LABELS.has(l);
      return `<div class="actual-card"><span class="tiny muted">${esc(l)}</span><b>${pctLbl?(v*100).toFixed(1)+'%':v.toFixed(pctLbl?3:1)}</b></div>`;
    }).join('')}</div>
    <p class="tiny muted" style="margin-top:10px">這是基於你手動輸入的實際比賽統計，不是 App 的預測值。可作為「我的陣容實際表現」與 App 預測值對照的參考。</p>`;
  }

  // ---------- main render ----------
  function render() {
    $('#hWeekSel').value=String(app.profile.week);
    initCatGrid(); if (statsOpen) initStatsGrid();
    const all=loadHistory(storage()); const matches=getLeagueMatches(all,app.activeId);
    const analysis=analyzeHistory(matches);
    renderActual(matches);

    // analysis
    const ap=$('#hAnalysis');
    if (!analysis) { $('#hAnalysisSub').textContent=''; ap.innerHTML=emptyState('還沒有記錄','先在上方輸入本週的對戰結果，累積幾週後這裡就會出現趨勢圖表。','info'); }
    else {
      const {total,cats,strong,weak,rolling}=analysis;
      $('#hAnalysisSub').textContent=`${analysis.matchCount} 場 · ${total.W}勝${total.L}敗${total.T?total.T+'和':''}`;
      const winPct=analysis.matchCount?(total.W/analysis.matchCount*100).toFixed(1):'0';
      ap.innerHTML=`<div class="pulse-cards" style="margin-bottom:16px">
        <div class="metric"><b>${total.W}–${total.L}${total.T?'–'+total.T:''}</b><span>整季戰績</span></div>
        <div class="metric"><b>${winPct}%</b><span>勝率</span></div>
        ${strong.length?`<div class="metric"><b style="font-size:14px;color:var(--good)">${strong.map((c)=>c.label).join(' · ')}</b><span>真實強項（≥60%）</span></div>`:''}
        ${weak.length?`<div class="metric"><b style="font-size:14px;color:var(--bad)">${weak.map((c)=>c.label).join(' · ')}</b><span>真實弱項（≤40%）</span></div>`:''}
      </div>
      ${rolling.length>=2?`<div class="hist-chart-label">勝率走勢</div>${winSparkline(rolling,{w:560,h:100})}`:''}
      ${cats.length>=3?`<div class="hist-chart-label" style="margin-top:16px">各分類勝率</div>${catBarChart(cats,{w:560,barH:20,gap:5})}`:''}
      <div class="hist-insight" style="margin-top:14px">
        ${strong.length?`<div class="banner info">${icon('star',16)}<div><b>真實強項</b>：${strong.map((c)=>`${c.label}（${(c.winRate*100).toFixed(0)}%，${c.played}場）`).join('、')}</div></div>`:''}
        ${weak.length?`<div class="banner warn" style="margin-top:8px">${icon('alert',16)}<div><b>真實弱項</b>：${weak.map((c)=>`${c.label}（${(c.winRate*100).toFixed(0)}%，${c.played}場）`).join('、')}</div></div>`:''}
        ${!strong.length&&!weak.length?`<p class="muted">再多記幾週後，這裡會自動分析你的真實強弱項。</p>`:''}
      </div>`;
    }

    // history list
    setHtml($('#hList'), !matches.length ? emptyState('還沒有記錄','','info') : matches.map((m)=>`
      <div class="hrow"><div class="hrow-top">
        <span class="hrow-week">${esc(m.weekLabel)}</span>
        <span class="hrow-res ${RESULT_CLS[m.result]}">${RESULT_LABEL[m.result]}</span>
        ${m.opponent?`<span class="muted">vs ${esc(m.opponent)}</span>`:''}
        ${m.score.w||m.score.l?`<span class="tiny muted">${m.score.w}W-${m.score.l}L${m.score.t?'-'+m.score.t+'T':''}</span>`:''}
        ${m.myStats&&Object.values(m.myStats).some((v)=>v!=null)?`<span class="badge b-blue" style="font-size:10px">含數據</span>`:''}
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn small ghost" data-act="open-detail" data-id="${esc(m.id)}" data-testid="h-detail-${esc(m.id)}">詳細</button>
          <button class="icon-btn" data-act="delete-match" data-id="${esc(m.id)}" style="width:28px;height:28px">${icon('trash',14)}</button>
        </div>
      </div>
      ${Object.keys(m.catResults??{}).length?`<div class="hrow-cats">${Object.entries(m.catResults).map(([c,v])=>`<span class="hcat-tag ${v}">${esc(c)}</span>`).join('')}</div>`:''}
      ${m.note?`<div class="tiny muted" style="margin-top:4px">${esc(m.note)}</div>`:''}
    </div>`).join(''));
  }

  return { id:'history', topics:['league','settings','h2h','week'], render };
}
void fmt1; void fmt2; void pct; void badge;
