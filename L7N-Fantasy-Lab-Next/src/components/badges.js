// Small shared HTML builders for status badges and category strength bars.
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export const badge = (text, tone = 'muted', title = '') => `<span class="badge b-${tone}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

/** Data-status badge for a player. Returns '' for ordinary current-basis stats. */
export function statusBadge(p) {
  switch (p.status) {
    case 'projection': return badge('估算 · L7N model', 'violet', '新秀 NBA 數據為模型估算，非官方預測，也不是實績');
    case 'historical': return badge(`歷史 ${p.statsSeason}`, 'amber', `${p.statsSeason} 歷史參考數據；不計入本季實績與參考池`);
    case 'no-games': return badge('GP=0', 'muted', '來源資料中此球員沒有出賽');
    case 'no-current': return badge('本期間無統計', 'muted', '此資料基準中沒有這位球員的統計；不會借用其他球季數據');
    case 'no-data': return badge('無統計資料', 'muted', '只有球員身分（來自 Yahoo 名單），尚未取得統計');
    default: return '';
  }
}

export const rookieBadge = (p) => (p.isRookie ? badge('ROOKIE', 'violet') : '');

export function strengthBar(entry, note = '') {
  const idx = Math.max(0, Math.min(100, entry.idx));
  const good = idx >= 50;
  const left = good ? 50 : idx; const width = Math.abs(idx - 50);
  const tone = idx >= 58 ? '強項' : idx < 47 ? '弱項' : '中性';
  return `<div class="sbar" data-cat="${esc(entry.k)}"><div class="sbar-top"><b>${esc(entry.k)}</b><span class="idx ${good ? 'good' : 'bad'}">${idx.toFixed(0)}</span></div>
<div class="sbar-track"><i class="sbar-mid"></i><i class="sbar-fill ${good ? 'good' : 'bad'}" style="left:${left}%;width:${width}%;transform-origin:${good ? 'left' : 'right'} center"></i></div>
<div class="sbar-note"><span class="tone-${tone === '強項' ? 'good' : tone === '弱項' ? 'bad' : 'mid'}">${tone}</span>${note ? ' · ' + esc(note) : ''}</div></div>`;
}

export const emptyState = (title, text = '', ic = 'info') => `<div class="empty">${icon(ic, 28)}<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
