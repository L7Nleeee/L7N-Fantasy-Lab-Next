// Shared table pieces so every tab renders a stat the same way (green/red tint comes from the model z-score).
import { STAT_COLUMNS } from '../engine/schema.js';
import { cellTone } from '../engine/model.js';
import { fmtStat } from '../ui/format.js';
import { esc } from '../ui/dom.js';
import { avatarHtml } from './avatar.js';
import { statusBadge, rookieBadge } from './badges.js';
import { TEAMS } from '../data/static/teams.js';

export function statCells(p, model) {
  return STAT_COLUMNS.map((c) => {
    const tone = cellTone(model, p, c.cat);
    const cls = [tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : '', c.key === 'dd' ? 'dd' : '', c.key === 'td' ? 'td' : ''].filter(Boolean).join(' ');
    return `<td class="${cls}">${fmtStat(c.kind, c.key, p[c.key])}</td>`;
  }).join('');
}

export const statHeads = () => STAT_COLUMNS.map((c) => `<th title="${esc(c.label)}">${esc(c.label)}</th>`).join('');

export const rowClass = (p) => (p.status === 'projection' ? 'p-projection' : p.status === 'historical' ? 'p-historical' : '');

/** Avatar + name + team line. `link` makes the name open the player's detail page. */
export function playerCell(p, { team, sub = '', link = true } = {}) {
  const t = team ?? p.team;
  const name = link ? `<button class="plink" data-detail="${esc(p.name)}"><span class="nm">${esc(p.name)}</span></button>` : `<span class="nm">${esc(p.name)}</span>`;
  return `<span class="pname">${avatarHtml({ ...p, team: t }, 'md')}<span style="min-width:0">${name}<span class="psub">${esc(TEAMS[t] || t || '—')}${sub ? ' · ' + sub : ''} ${rookieBadge(p)} ${statusBadge(p)}</span></span></span>`;
}
