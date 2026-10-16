// Minimal inline icon set (24x24, stroke currentColor).
const P = {
  draft: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 3-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.4.2 4.1 1.8 4.5 4.3"/>',
  weekly: '<path d="M4 20 14 10M14 10l-1-4 4-2 2 2-2 4-4-1zM20 20 10 10M10 10l1-4-4-2-2 2 2 4 4-1z"/>',
  schedule: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  players: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  rookies: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/>',
  yahoo: '<path d="M5 6h14M5 12h14M5 18h9"/><circle cx="19" cy="18" r="1.4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9M12 17.2v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4M4 4v4h4M4 13a8 8 0 0 0 14.3 4M20 20v-4h-4"/>',
  star: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.1"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>', upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>', league: '<path d="M4 20V10l8-6 8 6v10zM9.5 20v-6h5v6"/>',
};
export const icon = (name, size = 18, cls = '') => `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
