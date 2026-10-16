// Player registry: stable identity for every player we have ever seen. NEVER depends on GP > 0 and never shrinks.
import { normalizeName } from './util.mjs';

export const HEADSHOT_TEMPLATE = 'https://cdn.nba.com/headshots/nba/latest/1040x760/{id}.png';

/**
 * @param {object} p
 * @param {string} p.season          display string, e.g. "2026-27"
 * @param {string} p.previousSeason   display string, e.g. "2025-26"
 * @param {object[]} p.roster         rows from the NBA player-list endpoint (PERSON_ID, DISPLAY_FIRST_LAST, ROSTERSTATUS, TEAM_ABBREVIATION)
 * @param {object[]} p.currentGames   normalized game records, current season
 * @param {object[]} p.previousGames  normalized game records, previous season (may be [] when reusing the immutable previous dataset)
 * @param {Set<number>} [p.previousSeasonIds] ids known to have played last season when previousGames is not re-fetched
 * @param {object|null} p.previousRegistry last published registry (carried over, so nobody disappears)
 */
export function buildRegistry({ season, previousSeason, roster = [], currentGames = [], previousGames = [], previousSeasonIds = null, previousRegistry = null }) {
  const map = new Map();
  const add = (id, name, patch) => {
    let e = map.get(id);
    if (!e) { e = { id, name, aliases: [], team: null, rosterStatus: null, current: false, lastSeason: false, lastGameDate: null, seasonsSeen: [] }; map.set(id, e); }
    if (name && name !== e.name && !e.aliases.includes(name)) e.aliases.push(name);
    Object.assign(e, patch(e));
    return e;
  };
  for (const p of previousRegistry?.players ?? []) {
    map.set(p.id, { ...p, aliases: [...(p.aliases ?? [])], seasonsSeen: [...(p.seasonsSeen ?? [])], current: false, lastSeason: false });
  }
  const prevSeasonLabel = previousSeason;
  for (const r of roster) {
    const id = Number(r.PERSON_ID); if (!Number.isInteger(id) || id <= 0) continue;
    const active = Number(r.ROSTERSTATUS) === 1;
    add(id, String(r.DISPLAY_FIRST_LAST || '').trim(), (e) => ({ name: e.name || String(r.DISPLAY_FIRST_LAST).trim(), rosterStatus: active ? 'active' : 'inactive', current: active, team: r.TEAM_ABBREVIATION ? String(r.TEAM_ABBREVIATION) : e.team }));
  }
  const latest = new Map();
  for (const g of previousGames) add(g.playerId, g.name, (e) => ({ lastSeason: true, seasonsSeen: e.seasonsSeen.includes(prevSeasonLabel) ? e.seasonsSeen : [...e.seasonsSeen, prevSeasonLabel], lastGameDate: !e.lastGameDate || g.date > e.lastGameDate ? g.date : e.lastGameDate, team: e.team || g.team }));
  for (const id of previousSeasonIds ?? []) { const e = map.get(id); if (e) { e.lastSeason = true; if (!e.seasonsSeen.includes(prevSeasonLabel)) e.seasonsSeen.push(prevSeasonLabel); } }
  for (const g of currentGames) { const l = latest.get(g.playerId); if (!l || g.date >= l.date) latest.set(g.playerId, g); }
  for (const g of currentGames) add(g.playerId, g.name, (e) => ({ current: true, seasonsSeen: e.seasonsSeen.includes(season) ? e.seasonsSeen : [...e.seasonsSeen, season], lastGameDate: !e.lastGameDate || g.date > e.lastGameDate ? g.date : e.lastGameDate }));
  for (const [id, g] of latest) { const e = map.get(id); e.team = g.team || e.team; e.name = g.name || e.name; }
  for (const e of map.values()) e.aliases = [...new Set(e.aliases)].filter((a) => a !== e.name && normalizeName(a) !== '');
  const players = [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return { schema: 'l7n.player-registry/1', season, headshotTemplate: HEADSHOT_TEMPLATE, headshotCheck: null, players };
}
