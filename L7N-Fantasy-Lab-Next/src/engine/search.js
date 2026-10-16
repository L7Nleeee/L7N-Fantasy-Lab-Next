// Diacritic-insensitive player search with a few common nicknames. Pure.
import { normalizeName } from './util.js';
import { TEAMS } from '../data/static/teams.js';

const NICK = { wemby: 'wembanyama', sga: 'gilgeousalexander', kat: 'townsa', kd: 'durant', ad: 'davis', jokic: 'jokic', luka: 'doncic', steph: 'curry', giannis: 'antetokounmpo', greek: 'antetokounmpo', dame: 'lillard', embiid: 'embiid', ant: 'edwards', trae: 'young' };
const squash = (s) => normalizeName(s).replace(/ /g, '');

export function buildSearchIndex(players) {
  return players.map((p) => {
    const nm = normalizeName(p.name);
    const team = String(p.team || '').toLowerCase();
    const full = normalizeName(TEAMS[p.team] || '');
    return { p, nm, flat: nm.replace(/ /g, ''), words: nm.split(' '), team, full, rank: p.yahooRank ?? 9999 };
  });
}

/** @returns {object[]} players, best first. Empty query -> []. */
export function searchPlayers(index, query, { limit = 30, filter = null } = {}) {
  const q = normalizeName(query);
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean).map((t) => NICK[t] || t);
  const res = [];
  for (const e of index) {
    if (filter && !filter(e.p)) continue;
    let score = 0; let ok = true;
    for (const t of tokens) {
      if (/^\d+$/.test(t) && e.p.yahooRank === Number(t)) { score += 6; continue; }
      if (e.words.some((w) => w.startsWith(t))) score += 4;
      else if (e.flat.includes(t)) score += 2;
      else if (e.team === t) score += 3;
      else if (e.full.includes(t)) score += 1;
      else { ok = false; break; }
    }
    if (ok) res.push({ e, score });
  }
  res.sort((a, b) => b.score - a.score || a.e.rank - b.e.rank || a.e.nm.localeCompare(b.e.nm));
  return res.slice(0, limit).map((x) => x.e.p);
}
void squash;
