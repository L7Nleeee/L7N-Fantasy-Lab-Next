import { esc } from '../ui/dom.js';
export function toast(text, { level = 'info', ms = 3200 } = {}) {
  const host = document.getElementById('toasts'); if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${level}`; el.setAttribute('role', level === 'error' ? 'alert' : 'status');
  el.innerHTML = esc(text); host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); }, ms);
}
