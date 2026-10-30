// SVG sparkline + bar charts for history analysis. Neon game-style, no external deps.
import { esc } from '../ui/dom.js';

/** Rolling win% sparkline with dots on each match. */
export function winSparkline(rolling, { w = 480, h = 90 } = {}) {
  if (!rolling.length) return '';
  const n = rolling.length;
  const pad = { l: 32, r: 16, t: 14, b: 20 };
  const iw = w - pad.l - pad.r; const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v) => pad.t + ih * (1 - Math.max(0, Math.min(1, v)));
  const pts = rolling.map((r, i) => `${x(i).toFixed(1)},${y(r.winPct).toFixed(1)}`).join(' ');
  const area = rolling.map((r, i) => `${x(i).toFixed(1)},${y(r.winPct).toFixed(1)}`).join(' ') + ` ${x(n - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} ${pad.l.toFixed(1)},${(pad.t + ih).toFixed(1)}`;
  const dots = rolling.map((r, i) => {
    const col = r.result === 'W' ? 'var(--good)' : r.result === 'L' ? 'var(--bad)' : 'var(--muted)';
    const glyph = { W: '▲', L: '▽', T: '—' }[rolling[i]?.result ?? 'T'];
    void glyph;
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(r.winPct).toFixed(1)}" r="4" fill="${col}" stroke="rgba(0,0,0,.4)" stroke-width="1"/>`;
  }).join('');
  const labels = rolling.filter((_, i) => n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1).map((r, _, arr) => {
    const i = rolling.indexOf(r);
    return `<text x="${x(i).toFixed(1)}" y="${(pad.t + ih + 14).toFixed(1)}" text-anchor="middle" fill="var(--dim)" font-size="9.5" font-family="Inter,system-ui,sans-serif">W${r.weekLabel?.slice(1) ?? r.week}</text>`;
  }).join('');
  // 50% reference line
  const mid = y(0.5);
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%" role="img" aria-label="勝率走勢">
<defs><linearGradient id="spGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c5cff" stop-opacity=".35"/><stop offset="100%" stop-color="#7c5cff" stop-opacity="0"/></linearGradient></defs>
<line x1="${pad.l}" y1="${mid.toFixed(1)}" x2="${(pad.l + iw).toFixed(1)}" y2="${mid.toFixed(1)}" stroke="rgba(255,255,255,.12)" stroke-width="1" stroke-dasharray="4 3"/>
<polygon points="${area}" fill="url(#spGrad)"/>
<polyline points="${pts}" fill="none" stroke="url(#lineGrad)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
<defs><linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#7c5cff"/><stop offset="100%" stop-color="#3aa0ff"/></linearGradient></defs>
${dots}${labels}
<text x="${(pad.l - 4).toFixed(1)}" y="${(pad.t + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9" font-family="Inter,system-ui,sans-serif">100%</text>
<text x="${(pad.l - 4).toFixed(1)}" y="${(mid + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9" font-family="Inter,system-ui,sans-serif">50%</text>
<text x="${(pad.l - 4).toFixed(1)}" y="${(pad.t + ih + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9" font-family="Inter,system-ui,sans-serif">0%</text>
</svg>`;
}

/** Horizontal bar chart of per-category win rate. */
export function catBarChart(cats, { w = 480, barH = 22, gap = 6 } = {}) {
  if (!cats.length) return '';
  const labelW = 52; const pad = 12; const chartW = w - labelW - pad * 2;
  const h = cats.length * (barH + gap) + 8;
  const bars = cats.map((c, i) => {
    const y = 4 + i * (barH + gap);
    const wr = Math.max(0, Math.min(1, c.winRate));
    const bw = Math.min(chartW - 1, wr * chartW); const fill = wr >= 0.6 ? '#34d399' : wr <= 0.4 ? '#fb7185' : '#7c5cff';
    const pct = (wr * 100).toFixed(0) + '%';
    const textX = bw + 5 > chartW - 60 ? pad + labelW + bw - 5 : pad + labelW + bw + 5;
    const textAnchor = bw + 5 > chartW - 60 ? 'end' : 'start';
    return `<text x="${(pad + labelW - 4).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" fill="var(--text)" font-size="11" font-weight="700" font-family="Inter,system-ui,sans-serif">${esc(c.label)}</text>
<rect x="${pad + labelW}" y="${y}" width="${chartW}" height="${barH}" rx="4" fill="rgba(251,113,133,.12)"/>
<rect x="${pad + labelW}" y="${y}" width="${bw.toFixed(1)}" height="${barH}" rx="4" fill="${fill}" opacity=".85"/>
<text x="${textX.toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="${textAnchor}" fill="var(--text)" font-size="10.5" font-weight="700" font-family="Inter,system-ui,sans-serif">${pct} (${c.win}W/${c.loss}L)</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%" role="img" aria-label="各分類勝率"><line x1="${pad + labelW + chartW / 2}" y1="0" x2="${pad + labelW + chartW / 2}" y2="${h}" stroke="rgba(255,255,255,.08)" stroke-width="1" stroke-dasharray="3 3"/>${bars}</svg>`;
}
