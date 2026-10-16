// What-if simulation: swap players in/out of the roster without touching it. Pure.
import { teamTotals, h2hRows, h2hRecord } from './weekly.js';
import { teamStrength } from './model.js';

export const WHATIF_MAX = 4;
export const WHATIF_LABELS = ['PTS', '3PM', 'FTM', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FG', 'FT', 'P3', 'AT', 'DD'];

export function simulate({ team, whatIn, whatOut, weeklyCtx, model, oppPlayers, h2hCats }) {
  const out = new Set(whatOut);
  const simTeam = team.filter((p) => !out.has(p.name)).concat(whatIn);
  const before = teamTotals(team, weeklyCtx);
  const after = teamTotals(simTeam, weeklyCtx);
  const deltas = WHATIF_LABELS.map((k) => ({ k, before: before.raw[k], after: after.raw[k], diff: (after.raw[k] ?? 0) - (before.raw[k] ?? 0) }));
  const res = { simTeam, before, after, deltas, strengthBefore: model.status.ok ? teamStrength(team, model) : {}, strengthAfter: model.status.ok ? teamStrength(simTeam, model) : {}, record: null };
  if (oppPlayers?.length) {
    const opp = teamTotals(oppPlayers, weeklyCtx);
    const rb = h2hRecord(h2hRows(before, opp, h2hCats)); const ra = h2hRecord(h2hRows(after, opp, h2hCats));
    res.record = { before: rb, after: ra, delta: ra.w - rb.w };
  }
  return res;
}
