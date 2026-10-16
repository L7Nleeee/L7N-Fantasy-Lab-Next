// Tiny DOM helpers. Rendering is string-based into stable containers (inputs live outside re-rendered regions).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Replace innerHTML while keeping scroll offsets of the container (tables must not jump after a click). */
export function setHtml(el, html) {
  if (!el) return;
  const t = el.scrollTop; const l = el.scrollLeft;
  el.innerHTML = html;
  if (t) el.scrollTop = t;
  if (l) el.scrollLeft = l;
}

/** Event delegation: one listener per root, handler gets (event, matchedElement). */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const t = e.target instanceof Element ? e.target.closest(selector) : null;
    if (t && root.contains(t)) handler(e, t);
  });
}

export const debounce = (fn, ms) => { let t = null; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d; };
export const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
