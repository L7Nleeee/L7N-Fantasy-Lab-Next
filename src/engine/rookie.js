// L7N Rookie Translation v0.1 — transparent NCAA -> NBA per-game translation (ported verbatim from V4.0.21).
// The output is a MODEL ESTIMATE, never an official projection and never an NBA stat.
import { ratio } from './util.js';

export function rookieProjection(r) {
  const n = r.ncaa || {}; const p = r.pick; const pos = r.position || '';
  const role = p <= 4 ? 1.05 : p <= 10 ? 1.00 : p <= 14 ? 0.96 : p <= 30 ? 0.87 : 0.72;
  const pickMin = Math.max(15, Math.min(31, 31 - 0.34 * Math.max(0, p - 1)));
  const has = n.pts != null;
  const pts = has ? Math.max(6, n.pts * (pos.includes('G') ? 0.56 : 0.60) * role) : (p <= 14 ? 12 : 8);
  const reb = n.reb != null ? n.reb * 0.76 * role : (pos.includes('C') ? 5.4 : pos.includes('F') ? 4.8 : 3.3) * role;
  const ast = n.ast != null ? n.ast * 0.74 * role : (pos.includes('G') ? 3.2 : 2.0) * role;
  const stl = n.stl != null ? n.stl * 0.72 * role : 0.8 * role;
  const blk = n.blk != null ? n.blk * 0.72 * role : (pos.includes('C') ? 0.9 : pos.includes('F') ? 0.55 : 0.25) * role;
  const fg = n.fg != null ? Math.max(0.42, n.fg - 0.050) : 0.455;
  const ft = n.ft != null ? Math.max(0.68, n.ft - 0.035) : 0.76;
  const p3 = n.p3 != null ? Math.max(0.28, n.p3 - 0.045) : 0.335;
  const pm3 = n.pm3 != null ? n.pm3 * 0.85 * role : (pos.includes('G') ? 1.6 : 1.1) * role;
  const p3a = pm3 / Math.max(0.25, p3);
  const fga = Math.max(8.5, pts / (2 * fg * (1 - 0.32) + 3 * p3 * 0.24));
  const fta = Math.max(1.5, pts * 0.20);
  const tov = Math.max(1.2, ast * (pos.includes('G') ? 0.50 : 0.58));
  const gp = Math.round(pickMin * 2.3);
  return {
    gp, mpg: pickMin, minutes: pickMin * gp, pts, pm3, reb, ast, stl, blk, tov, fg, fga, ft, fta, ftm: fta * ft, p3, p3a,
    at: ratio(ast, tov), dd: null, td: null,
    projectionStatus: 'L7N model', projectionConfidence: p <= 10 ? 'medium' : 'low',
  };
}
