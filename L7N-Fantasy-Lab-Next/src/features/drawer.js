// Control Center (right drawer / mobile full-screen sheet): leagues, data center, model settings, weights, appearance, about.
import { $, $$, esc, on } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { DATA_BASES, BASIS_IDS, SCORING_CATS, CATS, RULES } from '../engine/schema.js';
import { askText, askConfirm } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { VERSION, PRODUCT } from '../version.js';
import { badge } from '../components/badges.js';
import { pipelineFreshness } from '../data/repository.js';
import { encodeShare } from '../state/profiles.js';

const dt = (s) => { if (!s) return '—'; try { return new Date(s).toLocaleString('zh-TW', { hour12: false }); } catch { return s; } };
const download = (name, obj) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const safe = (s) => String(s).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, '_');

export function createDrawer(ctx) {
  const { app, repo, headshots } = ctx;
  const back = document.createElement('div'); back.className = 'drawer-back'; back.hidden = true;
  const el = document.createElement('aside'); el.className = 'drawer'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '控制中心'); el.setAttribute('data-testid', 'drawer');
  document.body.append(back, el);
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.hidden = true; document.body.appendChild(fileInput);
  let fileMode = null;

  function datasetTable() {
    return `<table class="dset"><thead><tr><th>資料基準</th><th>狀態</th></tr></thead><tbody>${BASIS_IDS.map((b) => {
      const d = repo.describe(b);
      return `<tr><td><b>${DATA_BASES[b].label}</b><br><span class="tiny">${DATA_BASES[b].season} · ${d.period === 'full' ? '完整球季' : d.period === 'to-date' ? '開季至今' : '近 10 場'}</span></td>
      <td>${d.available ? `${badge(`${d.rows} 人`, 'green')} <span class="tiny">${esc(d.sourceLabel || d.source || '')}<br>${d.dateFrom && d.dateTo ? `涵蓋：${esc(d.dateFrom)} ～ ${esc(d.dateTo)}<br>` : ''}寫入：${dt(d.updatedAt)}</span>` : badge('尚未載入', 'muted')}
      <div class="row" style="margin-top:6px">${b === 'last' ? `<button class="btn small" data-act="sync" data-testid="sync-btn">${icon('sync', 14)}同步</button>` : ''}<button class="btn small" data-act="import" data-basis="${b}" data-testid="import-${b}">${icon('upload', 14)}匯入 CSV</button>${d.available ? `<button class="btn small ghost" data-act="clear-ds" data-basis="${b}">清除</button>` : ''}</div></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function pipelinePanel() {
    const m = repo.pipelineMeta; const url = app.settings.dataUrl || '';
    const fr = m?.datasetVersion ? pipelineFreshness(m) : null;
    const tone = { ok: 'green', warn: 'amber', stale: 'red', preseason: 'blue' }[fr?.level] || 'muted';
    const st = m?.lastAttempt; const err = m?.lastError;
    const rows = m?.files ? Object.entries(m.files).map(([k, v]) => `${esc(k.replace('.csv', '').replace('.json', ''))}：${v.rows}`).join('　') : '';
    return `<div class="dsec"><h4>L7N 資料管線（NBA 官方統計）</h4>
 <label class="lbl" for="dDataUrl">資料網址（資料夾，內含 manifest.json）。留空＝沿用舊版遠端 CSV</label>
 <div class="row" style="flex-wrap:nowrap"><input class="inp" id="dDataUrl" data-testid="data-url" placeholder="https://raw.githubusercontent.com/你的帳號/你的repo/data/data/" value="${esc(url)}" autocomplete="off" spellcheck="false"><button class="btn small primary" data-act="pipeline-sync" data-testid="pipeline-sync">${icon('sync', 14)}測試並同步</button></div>
 ${m?.datasetVersion ? `<div style="margin-top:10px" data-testid="pipeline-status"><div class="row">${badge('版本 ' + m.datasetVersion, 'green')}${fr ? badge(fr.level === 'stale' ? '資料過期' : fr.level === 'warn' ? '稍舊' : fr.level === 'preseason' ? '季前' : '資料新鮮', tone) : ''}${(m.warnings || []).length ? badge(`${m.warnings.length} 則警告`, 'amber', (m.warnings || []).join('\n')) : ''}</div>
 <p class="tiny" style="margin:6px 0 0">來源：${esc(m.source?.name || '—')}<br>賽季：${esc(m.season?.display || '')}　${fr ? esc(fr.text) : ''}<br>近 30 天：${esc(m.coverage?.recent30d?.dateFrom || '—')} ～ ${esc(m.coverage?.recent30d?.dateTo || '—')}　近 10 場：每位球員自己最近 10 場出賽<br>資料產生：${dt(m.generatedAt)}　最後檢查：${dt(m.checkedAt)}<br>筆數：${rows}<br>球員主檔：${m.registry?.players ?? '—'} 人（現役 ${m.registry?.currentPlayers ?? '—'}）${(m.emptyBases || []).length ? `<br>本次未更新（空資料或保留你手動匯入的）：${m.emptyBases.map((b) => DATA_BASES[b]?.short || b).join('、')}` : ''}</p></div>` : '<p class="tiny" style="margin:8px 0 0">尚未連到資料管線。</p>'}
 ${st && st.ok === false ? `<div class="banner error" style="margin:8px 0 0" data-testid="pipeline-failed">${icon('alert', 16)}<div><b>最近一次自動更新失敗（${esc(st.kind || '')}）</b>${esc(st.message || '')}<br><span class="tiny">${dt(st.at)}　目前仍使用上一份通過驗證的資料。</span></div></div>` : ''}
 ${err ? `<p class="tiny bad-t" style="margin:8px 0 0" data-testid="pipeline-error">這次同步沒有成功：${esc(err.message)}（${dt(err.at)}），目前沿用上次有效資料。</p>` : ''}</div>`;
  }

  function render() {
    const p = app.profile; const s = repo.sync; const u = app.universe();
    const syncTone = { ok: 'green', failed: 'red', syncing: 'blue', skipped: 'amber', idle: 'muted' }[s.state];
    el.innerHTML = `<div class="drawer-h"><h2>控制中心</h2><button class="icon-btn" data-act="close" aria-label="關閉" data-testid="drawer-close">${icon('close', 18)}</button></div><div class="drawer-b">
<div class="dsec"><h4>聯盟</h4>
 <select class="inp" id="dLeague" data-testid="league-select" aria-label="切換聯盟">${app.profiles.map((x) => `<option value="${esc(x.id)}" ${x.id === app.activeId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
 <div class="row" style="margin-top:8px"><button class="btn small primary" data-act="league-add" data-testid="league-add">${icon('plus', 14)}新增</button><button class="btn small" data-act="league-copy" data-testid="league-copy">複製目前</button><button class="btn small" data-act="league-rename" data-testid="league-rename">重新命名</button><button class="btn small danger" data-act="league-del" data-testid="league-del">${icon('trash', 14)}刪除</button></div>
 <div class="row" style="margin-top:8px"><button class="btn small" data-act="share">${icon('link', 14)}分享連結</button><button class="btn small" data-act="export">${icon('download', 14)}匯出此聯盟</button><button class="btn small" data-act="export-all">匯出全部</button><button class="btn small" data-act="import-cfg">${icon('upload', 14)}匯入設定</button></div>
 <p class="tiny" style="margin:8px 0 0">每個聯盟各自保存：roster、對手、權重、資料基準、賽週、參考池、場次與球隊覆寫、我的選人順位。球員資料庫為所有聯盟共用。</p></div>
${pipelinePanel()}
<div class="dsec"><h4>資料中心</h4><div class="row" style="margin-bottom:8px">${badge(s.state === 'idle' ? '尚未同步' : s.message || s.state, syncTone)}</div>${datasetTable()}
 <p class="tiny" style="margin:8px 0 0">目前分析用：<b>${esc(DATA_BASES[p.dataBasis].label)}</b>${u.used !== p.dataBasis ? `（實際顯示：${u.used === 'seed' ? '內建種子' : esc(DATA_BASES[u.used].label)}）` : ''}。更新本季或近 10 場資料不會覆蓋 2025-26 完整球季。匯入失敗或網路失敗時，上次成功的資料會被保留。</p></div>
<div class="dsec"><h4>模型設定（此聯盟）</h4>
 <div class="field"><label class="lbl" for="dBasis">分析數據基準</label><select class="inp" id="dBasis" data-testid="basis-select">${BASIS_IDS.map((b) => `<option value="${b}" ${p.dataBasis === b ? 'selected' : ''}>${DATA_BASES[b].label}${repo.describe(b).available ? '' : '（尚未載入）'}</option>`).join('')}</select></div>
 <div class="field"><label class="lbl" for="dMinGp">最低 GP（${RULES.minGpFloor}–${RULES.maxGp}）</label><input class="inp" id="dMinGp" type="number" min="${RULES.minGpFloor}" max="${RULES.maxGp}" value="${p.minGP}" data-testid="mingp"></div>
 <div class="field"><label class="lbl" for="dRef">參考池</label><select class="inp" id="dRef" data-testid="refmode"><option value="top200" ${p.refMode === 'top200' ? 'selected' : ''}>前 200 穩定出賽球員</option><option value="league" ${p.refMode === 'league' ? 'selected' : ''}>Fantasy 合格球員池（穩健）</option></select></div>
 <p class="tiny">${esc(u.meta?.sourceLabel || '')}。參考池：GP ≥ 最低 GP 且 ≥ ${RULES.minMpg} MPG；FG% / FT% / 3P% 另需上季 GP ≥ ${RULES.pctBaselineGp}；5%/95% winsorized；50 為中性。</p></div>
<div class="dsec"><h4>分類權重（0 = Punt）</h4><div class="wgrid">${SCORING_CATS.map((k) => `<div class="wcell ${p.weights[k] === 0 ? 'off' : ''}"><span>${k}</span><input class="inp" type="number" min="0" step="0.25" value="${p.weights[k]}" data-w="${esc(k)}" data-testid="w-${esc(k)}" aria-label="${esc(k)} 權重"></div>`).join('')}</div>
 <div class="row" style="margin-top:8px"><button class="btn small" data-act="reset-w" data-testid="reset-w">全部重設為 1</button></div>
 <p class="tiny" style="margin:8px 0 0">TOV 為反向分類（失誤越少越好）。TD（${CATS.TD.label}）只顯示、不計分。DD 以 DD/G 計分，避免 GP 偏差。</p></div>
<div class="dsec"><h4>外觀與隱私</h4>
 <label class="check"><input type="checkbox" id="dPhotos" ${app.settings.photos ? 'checked' : ''} data-testid="photos-toggle"> 顯示球員官方大頭照（從 cdn.nba.com 載入圖片，只以 NBA 球員 ID 查詢，不會送出姓名；滑過或點擊可放大）</label>
 <div style="height:8px"></div><label class="check"><input type="checkbox" id="dMotion" ${app.settings.reduceMotion ? 'checked' : ''}> 減少動畫</label>
 <p class="tiny" style="margin:8px 0 0">所有設定與資料只存在這個瀏覽器；沒有帳號、沒有自架後端。</p></div>
<div class="dsec"><h4>關於</h4><p class="tiny" style="margin:0">${PRODUCT} v${VERSION}｜Fantasy Engine 規則承襲 L7N V4.0.21（未更動）｜原版與其資料不會被這個版本修改。</p></div>
</div>`;
  }

  function open() {
    render(); back.hidden = false; el.hidden = false; document.body.classList.add('no-scroll');
    requestAnimationFrame(() => { back.classList.add('in'); el.classList.add('in'); });
    $('[data-act="close"]', el)?.focus();
  }
  function close() {
    back.classList.remove('in'); el.classList.remove('in'); document.body.classList.remove('no-scroll');
    setTimeout(() => { back.hidden = true; el.hidden = true; }, 260);
  }
  const isOpen = () => !el.hidden;

  back.addEventListener('click', close);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  on(el, 'click', '[data-act]', async (e, t) => {
    const a = t.dataset.act;
    if (a === 'close') close();
    else if (a === 'league-add') { const n = await askText({ title: '新增聯盟', label: '聯盟名稱', value: `聯盟 ${app.profiles.length + 1}` }); if (n && app.addLeague(n)) { toast(`已建立聯盟「${n.trim()}」`, { level: 'ok' }); render(); } }
    else if (a === 'league-copy') { const n = await askText({ title: '複製目前聯盟', label: '新聯盟名稱', value: app.profile.name + ' Copy' }); if (n && app.copyLeague(n)) { toast('已複製聯盟', { level: 'ok' }); render(); } }
    else if (a === 'league-rename') { const n = await askText({ title: '重新命名', label: '聯盟名稱', value: app.profile.name }); if (n && app.renameLeague(n)) render(); }
    else if (a === 'league-del') {
      if (app.profiles.length <= 1) { toast('至少要保留一個聯盟。', { level: 'warn' }); return; }
      if (await askConfirm({ title: `刪除「${app.profile.name}」？`, text: '這個聯盟的 roster 與設定會一起刪除，無法復原。', ok: '刪除', danger: true })) { app.deleteLeague(); render(); }
    }
    else if (a === 'share') {
      const url = location.href.split('#')[0] + '#share=' + encodeShare(app.profile);
      try { await navigator.clipboard.writeText(url); toast(location.protocol === 'file:' ? '已複製連結（目前是本機檔案，朋友需要公開網址才打得開）' : '分享連結已複製', { level: 'ok' }); } catch { prompt('複製這個連結：', url); }
    }
    else if (a === 'export') download(`${safe(PRODUCT)}_${safe(app.profile.name)}_v${VERSION}.json`, app.exportLeague());
    else if (a === 'export-all') download(`${safe(PRODUCT)}_AllLeagues_v${VERSION}.json`, app.exportEverything());
    else if (a === 'import-cfg') { fileMode = { kind: 'config' }; fileInput.accept = '.json,application/json'; fileInput.click(); }
    else if (a === 'import') { fileMode = { kind: 'csv', basis: t.dataset.basis }; fileInput.accept = '.csv,text/csv,text/plain'; fileInput.click(); }
    else if (a === 'pipeline-sync') { const url = $('#dDataUrl', el).value.trim(); app.setSetting('dataUrl', url); if (!url) { toast('已改回沿用舊版遠端 CSV', { level: 'info' }); render(); return; } const r = await repo.syncPipeline(url, { force: true }); toast(r.ok ? (r.unchanged ? '資料已是最新' : `已同步（${r.version}）`) : `同步未成功：${r.error}`, { level: r.ok ? 'ok' : 'warn', ms: 5000 }); render(); }
    else if (a === 'sync') { const r = await repo.syncRemote('last', { force: true }); toast(r.ok ? `已同步 ${r.count} 位球員` : `同步未成功：${r.error || ''}，已保留原本資料`, { level: r.ok ? 'ok' : 'warn' }); render(); }
    else if (a === 'clear-ds') { if (await askConfirm({ title: '清除這份資料？', text: `${DATA_BASES[t.dataset.basis].label} 的資料會從這個瀏覽器移除（其他資料集不受影響）。`, ok: '清除', danger: true })) { repo.clearDataset(t.dataset.basis); render(); } }
    else if (a === 'reset-w') { app.resetWeights(); render(); }
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]; fileInput.value = ''; if (!f || !fileMode) return;
    const text = await f.text();
    if (fileMode.kind === 'csv') {
      const r = repo.importCsv(fileMode.basis, text, { label: f.name });
      if (r.ok) { toast(`已匯入 ${r.count} 位球員（${r.mode === 'per-game' ? '每場平均' : '球季總計'}格式）→ ${DATA_BASES[fileMode.basis].label}`, { level: 'ok', ms: 4500 }); (r.warnings || []).forEach((w) => toast(w, { level: 'warn', ms: 5000 })); }
      else toast(`匯入失敗：${r.error}`, { level: 'error', ms: 6000 });
    } else {
      const r = app.importConfig(text);
      if (r.ok) { toast(`已匯入 ${r.count} 個聯盟`, { level: 'ok' }); r.warnings.forEach((w) => toast(w, { level: 'info' })); } else toast(`匯入失敗：${r.error}`, { level: 'error', ms: 5000 });
    }
    render();
  });

  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'dLeague') { app.switchLeague(t.value); render(); }
    else if (t.id === 'dBasis') app.setBasis(t.value);
    else if (t.id === 'dMinGp') { app.setMinGP(t.value); t.value = app.profile.minGP; }
    else if (t.id === 'dRef') app.setRefMode(t.value);
    else if (t.dataset.w) { app.setWeight(t.dataset.w, t.value); t.closest('.wcell').classList.toggle('off', app.profile.weights[t.dataset.w] === 0); t.value = app.profile.weights[t.dataset.w]; }
    else if (t.id === 'dPhotos') { app.setSetting('photos', t.checked); headshots.setEnabled(t.checked); app.emit(['data']); }
    else if (t.id === 'dMotion') { app.setSetting('reduceMotion', t.checked); document.body.classList.toggle('reduce-motion', t.checked); }
  });
  repo.subscribe(() => { if (isOpen()) { const sc = $('.drawer-b', el)?.scrollTop || 0; render(); const b = $('.drawer-b', el); if (b) b.scrollTop = sc; } });
  void $$;
  return { open, close, isOpen };
}
