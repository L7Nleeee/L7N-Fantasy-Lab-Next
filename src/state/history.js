// Weekly H2H match history — stored per-league.
// MatchRecord v2: now includes full weekly stat totals for both sides.
// { id, week, weekLabel, season, result:'W'|'L'|'T', score:{w,l,t},
//   catResults:{[label]:'win'|'loss'|'tie'},
//   myStats:{[label]:number|null},     // actual weekly totals for my team
//   oppStats:{[label]:number|null},    // actual weekly totals for opponent
//   opponent, note, recordedAt }
import { NS } from './storage.js';

export const HISTORY_KEY = 'h2h.history';
// All trackable stat labels (standard + custom can extend via customH2HCats)
export const STAT_LABELS = ['FG%','FT%','3P%','FGM','FTM','3PM','PTS','REB','AST','STL','BLK','TOV','DD','A/T'];
export const PCT_LABELS  = new Set(['FG%','FT%','3P%','A/T']);
export const REVERSE_LABELS = new Set(['TOV']);

export function loadHistory(storage) { return storage.getJSON(HISTORY_KEY, {}); }
export function saveHistory(storage, data) { return storage.setJSON(HISTORY_KEY, data); }

export function getLeagueMatches(data, leagueId) {
  return (data[leagueId]?.matches ?? []).slice().sort((a, b) =>
    b.week - a.week || (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
}

export function addMatch(data, leagueId, match) {
  const league = data[leagueId] ?? { matches: [] };
  const idx = league.matches.findIndex((m) => m.week === match.week && m.season === match.season);
  const updated = idx >= 0
    ? league.matches.map((m, i) => (i === idx ? { ...match } : m))
    : [...league.matches, { ...match }];
  return { ...data, [leagueId]: { ...league, matches: updated } };
}

export function deleteMatch(data, leagueId, matchId) {
  const league = data[leagueId]; if (!league) return data;
  return { ...data, [leagueId]: { ...league, matches: league.matches.filter((m) => m.id !== matchId) } };
}

/** Build a "my actual" dataset from all matches that have myStats filled in. */
export function buildActualDataset(matches) {
  const withStats = matches.filter((m) => m.myStats && Object.values(m.myStats).some((v) => v != null));
  if (!withStats.length) return null;
  // per-category: running total / count -> average
  const totals = {}; const counts = {};
  for (const m of withStats) {
    for (const [k, v] of Object.entries(m.myStats ?? {})) {
      if (v == null || isNaN(Number(v))) continue;
      totals[k] = (totals[k] ?? 0) + Number(v);
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const avgs = Object.fromEntries(Object.keys(totals).map((k) => [k, totals[k] / counts[k]]));
  return { weeks: withStats.length, avgs, matches: withStats };
}

/** Aggregate stats across matches for the analysis panel. */
export function analyzeHistory(matches) {
  if (!matches.length) return null;
  const total = { W: 0, L: 0, T: 0 };
  const catTotals = {};
  for (const m of matches) {
    total[m.result] = (total[m.result] || 0) + 1;
    for (const [label, res] of Object.entries(m.catResults ?? {})) {
      if (!catTotals[label]) catTotals[label] = { win: 0, loss: 0, tie: 0 };
      catTotals[label][res] = (catTotals[label][res] || 0) + 1;
    }
  }
  const cats = Object.entries(catTotals).map(([label, r]) => {
    const played = r.win + r.loss + r.tie;
    return { label, ...r, played, winRate: played ? r.win / played : 0 };
  }).sort((a, b) => b.winRate - a.winRate);
  const strong = cats.filter((c) => c.winRate >= 0.6 && c.played >= 2);
  const weak   = cats.filter((c) => c.winRate <= 0.4 && c.played >= 2);
  const rolling = matches.slice().sort((a, b) => a.week - b.week).map((m, i, arr) => {
    const slice = arr.slice(0, i + 1);
    const w = slice.filter((x) => x.result === 'W').length;
    return { week: m.week, weekLabel: m.weekLabel, result: m.result,
      w, l: slice.filter((x) => x.result === 'L').length,
      t: slice.filter((x) => x.result === 'T').length, winPct: w / (i + 1) };
  });
  return { total, cats, strong, weak, rolling, matchCount: matches.length };
}
void NS;
