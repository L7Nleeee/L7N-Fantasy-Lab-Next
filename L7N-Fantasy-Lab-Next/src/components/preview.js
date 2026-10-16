// Enlarged headshot preview. A single fixed-position element on <body>: it never takes part in table layout, so rows do not change height,
// the page does not reflow and scroll positions do not move.
//   desktop: pointer hover / keyboard focus opens, leaving / blur closes.   touch: tap opens, tap again / tap outside / Escape closes.
import { nbaHeadshotUrl } from '../data/nba-image.js';
import { markPhotoFailedId } from './avatar.js';

export function initPreview() {
  if (document.getElementById('avPreview')) return;
  const el = document.createElement('div');
  el.id = 'avPreview'; el.className = 'av-preview'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '球員照片預覽'); el.setAttribute('data-testid', 'av-preview');
  el.innerHTML = '<img alt="" width="240" height="175" decoding="async" referrerpolicy="no-referrer"><div class="av-preview-cap"></div>';
  document.body.appendChild(el);
  const img = el.querySelector('img'); const cap = el.querySelector('.av-preview-cap');
  let current = null; let sticky = false; let timer = null; let lastType = 'mouse';

  const hide = () => { clearTimeout(timer); el.classList.remove('in'); sticky = false; current = null; el.hidden = true; };
  function place(av) {
    const r = av.getBoundingClientRect(); const W = 240; const H = 175 + 30; const vw = innerWidth; const vh = innerHeight;
    let left = r.right + 12; if (left + W > vw - 8) left = r.left - W - 12; if (left < 8) left = Math.max(8, Math.min(vw - W - 8, r.left + r.width / 2 - W / 2));
    let top = r.top + r.height / 2 - H / 2; top = Math.max(8, Math.min(vh - H - 8, top));
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
  }
  function show(av, isSticky) {
    const id = Number(av.dataset.nba); const url = nbaHeadshotUrl(id, 'large'); if (!url) return;
    current = av; sticky = isSticky;
    img.onerror = () => { markPhotoFailedId(id); hide(); }; img.alt = `${av.dataset.name} 大頭照（放大）`; img.src = url; cap.textContent = av.dataset.name;
    el.hidden = false; place(av); requestAnimationFrame(() => el.classList.add('in'));
  }
  const avOf = (t) => (t instanceof Element ? t.closest('.av.has-nba') : null);

  document.addEventListener('pointerdown', (e) => { lastType = e.pointerType || 'mouse'; }, true);
  document.addEventListener('keydown', () => { lastType = 'keyboard'; }, true);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return; const av = avOf(e.target); if (!av || (current === av && sticky)) return;
    clearTimeout(timer); timer = setTimeout(() => show(av, false), 110);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return; const av = avOf(e.target); if (!av || av.contains(e.relatedTarget)) return;
    clearTimeout(timer); if (!sticky) hide();
  });
  document.addEventListener('focusin', (e) => { const av = avOf(e.target); if (av && lastType !== 'touch' && lastType !== 'pen') show(av, false); });   // a tap also focuses: the click handler owns touch behaviour
  document.addEventListener('focusout', (e) => { if (avOf(e.target) && !sticky) hide(); });
  document.addEventListener('click', (e) => {
    const av = avOf(e.target);
    if (av && (lastType === 'touch' || lastType === 'pen')) { e.preventDefault(); if (current === av && !el.hidden) hide(); else show(av, true); return; }
    if (!el.hidden && !el.contains(e.target) && !av) hide();
    else if (el.contains(e.target) && sticky) hide();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { hide(); return; }
    const av = avOf(document.activeElement);
    if (av && (e.key === 'Enter' || e.key === ' ') && e.target === av) { e.preventDefault(); if (current === av && sticky && !el.hidden) hide(); else show(av, true); }
  });
  addEventListener('resize', hide);
  addEventListener('scroll', () => { if (!sticky && !el.hidden) hide(); }, { passive: true, capture: true });
  return { hide };
}
