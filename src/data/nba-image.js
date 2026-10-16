// Pure helpers for official NBA.com headshot URLs (no DOM, no imports). Id-only addressing: never derived from a name.
export const NBA_HEADSHOT_BASE = 'https://cdn.nba.com/headshots/nba/latest';
export const NBA_SIZES = Object.freeze({ small: '260x190', large: '1040x760' });
export const isNbaId = (id) => Number.isInteger(id) && id > 0;
export const nbaHeadshotUrl = (id, size = 'small') => (isNbaId(id) ? `${NBA_HEADSHOT_BASE}/${NBA_SIZES[size] || NBA_SIZES.small}/${id}.png` : null);
