// Player avatar: team-colored initials always; the official NBA headshot is layered on top only when the player has a verified NBA id.
// The <img> is part of the HTML (lazy, fixed dimensions -> no layout shift). Load/error are handled by two delegated capture listeners:
// on error the image is removed and the initials remain, so a wrong or missing picture can never replace the fallback.
import { TEAM_COLORS } from '../data/static/teams.js';
import { esc } from '../ui/dom.js';
import { nbaHeadshotUrl } from '../data/nba-image.js';

const PX = { sm: 26, md: 36, lg: 64, xl: 92 };
let photosOn = true; const failed = new Set();
export const setPhotosEnabled = (v) => {
  photosOn = !!v;
  if (!photosOn && typeof document !== 'undefined') {          // switching off removes every picture right away, in all (even hidden) views
    for (const img of document.querySelectorAll('img.av-img')) { const av = img.parentElement; img.remove(); if (av) { av.classList.remove('has-nba', 'loaded'); for (const a of ['data-nba', 'data-name', 'tabindex', 'role', 'aria-label']) av.removeAttribute(a); } }
  }
};
export const photoFailed = (id) => failed.has(id);
export const markPhotoFailedId = (id) => { failed.add(id); };

const initialsOf = (name) => {
  const parts = String(name).replace(/[.’'()#\d]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

export function avatarHtml(p, size = 'md') {
  const team = p.team && TEAM_COLORS[p.team] ? p.team : null;
  const c = team ? TEAM_COLORS[team] : '#5d6b82';
  const url = photosOn && p.nbaId && !failed.has(p.nbaId) ? nbaHeadshotUrl(p.nbaId, 'small') : null;
  const px = PX[size] || 36;
  const img = url ? `<img class="av-img" src="${url}" alt="${esc(p.name)} 大頭照" width="${px}" height="${px}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-nba-id="${p.nbaId}">` : '';
  const a11y = url ? ` data-nba="${p.nbaId}" data-name="${esc(p.name)}" tabindex="0" role="button" aria-label="放大 ${esc(p.name)} 的照片"` : '';
  return `<span class="av av-${size}${url ? ' has-nba' : ''}"${a11y} style="--tc:${c}"><span class="av-i">${esc(initialsOf(p.name))}</span>${img}</span>`;
}

/** Kept for call-site compatibility: images are in the HTML now, nothing to hydrate. */
export function hydrateAvatars() {}

if (typeof document !== 'undefined') {
  document.addEventListener('load', (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.classList.contains('av-img')) t.parentElement?.classList.add('loaded'); }, true);
  document.addEventListener('error', (e) => {
    const t = e.target; if (!(t instanceof HTMLImageElement) || !t.classList.contains('av-img')) return;
    const id = Number(t.dataset.nbaId); if (id) failed.add(id);
    const av = t.parentElement; t.remove();
    if (av) { av.classList.remove('has-nba', 'loaded'); for (const a of ['data-nba', 'data-name', 'tabindex', 'role', 'aria-label']) av.removeAttribute(a); }
  }, true);
}
