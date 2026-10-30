// SVG Radar chart — pure function, no external deps. Game-style neon palette.
// axes: [{key, label, value (0-100), zScore}]
import { esc } from '../ui/dom.js';

const NEON = ['#7c5cff','#3aa0ff','#e04fff','#34d399','#fbbf24','#fb7185','#67e8f9','#a78bfa','#4ade80','#f472b6','#facc15','#60a5fa','#2dd4bf'];

export function radarSvg(axes, { size = 300, levels = 5, fill = true, label = true, animated = true } = {}) {
  if (!axes.length) return '';
  const cx = size / 2; const cy = size / 2;
  const R = size * 0.36;                                       // polygon radius
  const labelR = size * 0.46;
  const n = axes.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2; // start top
  const pt = (r, i) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  // background rings
  const rings = Array.from({ length: levels }, (_, k) => {
    const r = R * (k + 1) / levels;
    const pts = Array.from({ length: n }, (_, i) => pt(r, i).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="rgba(160,175,255,.12)" stroke-width="1"/>`;
  }).join('');

  // axis lines
  const axisLines = axes.map((_, i) => {
    const [x, y] = pt(R, i);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(160,175,255,.18)" stroke-width="1"/>`;
  }).join('');

  // data polygon
  const dataPts = axes.map((a, i) => {
    const r = R * Math.max(0, Math.min(100, a.value ?? 50)) / 100;
    return pt(r, i).map((v) => v.toFixed(1)).join(',');
  }).join(' ');

  // stroke gradient via multiple segments
  const segLines = axes.map((a, i) => {
    const j = (i + 1) % n;
    const [x1, y1] = pt(R * Math.max(0, Math.min(100, a.value ?? 50)) / 100, i);
    const [x2, y2] = pt(R * Math.max(0, Math.min(100, axes[j].value ?? 50)) / 100, j);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${NEON[i % NEON.length]}" stroke-width="2.2" stroke-linecap="round"/>`;
  }).join('');

  // dots
  const dots = axes.map((a, i) => {
    const r = R * Math.max(0, Math.min(100, a.value ?? 50)) / 100;
    const [x, y] = pt(r, i);
    const isHigh = (a.rawIdx ?? a.value ?? 50) >= 58; const isLow = (a.rawIdx ?? a.value ?? 50) <= 44;
    const col = isHigh ? 'var(--good)' : isLow ? 'var(--bad)' : NEON[i % NEON.length];
    const glowId = `glow-${i}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${col}" stroke="rgba(0,0,0,.5)" stroke-width="1.2" filter="url(#${glowId})"/>`;
  }).join('');

  // labels
  const labels = !label ? '' : axes.map((a, i) => {
    const [x, y] = pt(labelR, i);
    const anchor = x < cx - 8 ? 'end' : x > cx + 8 ? 'start' : 'middle';
    const isHigh = (a.rawIdx ?? a.value ?? 50) >= 58; const isLow = (a.rawIdx ?? a.value ?? 50) <= 44;
    const col = isHigh ? 'var(--good)' : isLow ? 'var(--bad)' : 'var(--text)';
    const val = (a.rawIdx ?? a.value ?? 50).toFixed(0);
    return `<text x="${x.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="${anchor}" fill="${col}" font-size="11" font-weight="700" font-family="Inter,system-ui,sans-serif">${esc(a.label)}</text>
<text x="${x.toFixed(1)}" y="${(y + 9).toFixed(1)}" text-anchor="${anchor}" fill="${col}" font-size="10" font-family="Inter,system-ui,sans-serif" opacity=".8">${val}</text>`;
  }).join('');

  // glow filters
  const filters = axes.map((a, i) => {
    const isHigh = (a.rawIdx ?? a.value ?? 50) >= 58; const isLow = (a.rawIdx ?? a.value ?? 50) <= 44;
    const col = isHigh ? '52,211,153' : isLow ? '251,113,133' : '124,92,255';
    return `<filter id="glow-${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/><feColorMatrix in="blur" type="matrix" values="0 0 0 0 ${col.split(',').map((v,j)=>j<3?Number(v)/255:1).join(' 0 0 0 0 ')}1 0" result="glow"/><feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  }).join('');

  const anim = animated ? `<style>.radar-fill{animation:radarIn .7s cubic-bezier(.2,.8,.2,1) both}@keyframes radarIn{from{opacity:0;transform-origin:${cx}px ${cy}px;transform:scale(.3)}to{opacity:1;transform:scale(1)}}</style>` : '';

  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${size}px;display:block" role="img" aria-label="分類強弱雷達圖">
<defs>${filters}</defs>${anim}
${rings}${axisLines}
${fill ? `<polygon class="radar-fill" points="${dataPts}" fill="rgba(124,92,255,.15)" stroke="none"/>` : ''}
<g class="radar-fill">${segLines}${dots}</g>
${labels}
<circle cx="${cx}" cy="${cy}" r="3" fill="rgba(255,255,255,.3)"/>
</svg>`;
}

/** Convert model strength entries to radar axes (0–100 index). */
/**
 * Remap raw strength indices (typically 30–70) to visual 0–100 using a
 * soft stretch: the actual min and max of this team's values anchor to
 * ~10% and ~90% of the polygon so even small spreads are visible.
 * A hard-coded band [FLOOR=30, CEIL=70] ensures the scale never collapses.
 */
export function strengthToAxes(entries) {
  const vals = entries.map((e) => e.idx);
  const FLOOR = 30; const CEIL = 70;
  const lo = Math.min(FLOOR, ...vals); const hi = Math.max(CEIL, ...vals);
  const span = hi - lo || 1;
  // map lo→8, hi→92  (leaves breathing room at edges)
  const toVisual = (v) => 8 + ((v - lo) / span) * 84;
  return entries.map((e) => ({
    key: e.k, label: e.k,
    value: Math.max(0, Math.min(100, toVisual(e.idx))),
    rawIdx: e.idx, zScore: e.z,
  }));
}
