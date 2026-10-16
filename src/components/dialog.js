// Non-blocking replacements for window.prompt / confirm (they freeze mobile browsers and can't be styled).
import { esc } from '../ui/dom.js';

export function open(inner, { onKey, onMount } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap'; wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const prevFocus = document.activeElement;
    const close = (val) => { wrap.classList.remove('in'); setTimeout(() => { wrap.remove(); prevFocus?.focus?.(); }, 160); resolve(val); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } else onKey?.(e, close, wrap); });
    wrap.querySelector('[data-dlg-cancel]')?.addEventListener('click', () => close(null));
    onMount?.(wrap, close);
    if (!onMount) wrap.querySelector('[data-dlg-ok]')?.addEventListener('click', () => close(wrap.querySelector('input')?.value ?? true));
    (wrap.querySelector('input') || wrap.querySelector('[data-dlg-ok]'))?.focus();
    wrap.querySelector('input')?.select();
  });
}

export const askText = ({ title, label = '', value = '', ok = '確定' }) => open(
  `<h3>${esc(title)}</h3>${label ? `<label class="lbl">${esc(label)}</label>` : ''}<input class="inp" data-testid="dlg-input" value="${esc(value)}" maxlength="80"><div class="modal-actions"><button class="btn" data-dlg-cancel>取消</button><button class="btn primary" data-dlg-ok data-testid="dlg-ok">${esc(ok)}</button></div>`,
  { onKey: (e, close, wrap) => { if (e.key === 'Enter') { e.preventDefault(); close(wrap.querySelector('input').value); } } },
);

export const askConfirm = ({ title, text = '', ok = '確定', danger = false }) => open(
  `<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="modal-actions"><button class="btn" data-dlg-cancel>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-dlg-ok data-testid="dlg-ok">${esc(ok)}</button></div>`,
).then((v) => v === true);
