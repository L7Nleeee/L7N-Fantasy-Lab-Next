// Fantasy Engine — pure functions only. No DOM, no storage, no globals.
// Ported from L7N V4.0.21 model()/refStats()/val()/fit(). Rules intentionally unchanged.
import { CATS, SCORING_CATS, RULES } from './schema.js';
import { isNum, clamp } from './util.js';

export const mpgOf = (p) => (isNum(p.minutes) && isNum(p.gp) && p.gp > 0 ? p.minutes / p.gp : 0);

/** Reference-pool eligibility: enough GP, >= 12 MPG, and rookies only once they have real NBA stats. */
export function isReferenceEligible(p, { minGP }) {
  return isNum(p.gp) && p.gp >= minGP && mpgOf(p) >= RULES.minMpg
    && p.status !== 'historical'
    && (!p.isRookie || p.projectionStatus === 'NBA real stats');
}

export function referencePool(players, { minGP, refMode }) {
  let q = players.filter((p) => isReferenceEligible(p, { minGP }));
  if (refMode === 'top200') {
    q = q.slice().sort((a, b) => ((b.minutes || b.gp * 30) - (a.minutes || a.gp * 30))).slice(0, RULES.topN);
  }
  return q;
}

/** 5/95 winsorized mean and sample sd. */
export function robustMoments(xs) {
  const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return { mean: 0, sd: 1 };
  const n = a.length;
  const lo = a[Math.floor((n - 1) * RULES.winsorTail)];
  const hi = a[Math.ceil((n - 1) * (1 - RULES.winsorTail))];
  const w = a.map((v) => Math.max(lo, Math.min(v, hi)));
  const mean = w.reduce((s, v) => s + v, 0) / w.length;
  const sd = Math.sqrt(w.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, w.length - 1)) || 1;
  return { mean, sd };
}

/** Pool-level reference values. Percentages are volume-weighted; A/T is pool AST / pool TOV. */
export function refStats(pool) {
  const wavg = (k, v) => {
    let n = 0; let d = 0;
    for (const p of pool) {
      const vol = Math.max(0, isNum(p[v]) ? p[v] : 0);
      if (isNum(p[k]) && vol > 0) { n += p[k] * vol; d += vol; }
    }
    return d ? n / d : null;
  };
  const n = pool.length || 1;
  const sumOf = (k) => pool.reduce((s, p) => s + (isNum(p[k]) ? p[k] : 0), 0);
  const ddRows = pool.filter((p) => isNum(p.dd) && p.gp > 0);
  return {
    fg: wavg('fg', 'fga'), ft: wavg('ft', 'fta'), ftm: sumOf('ftm') / n, p3: wavg('p3', 'p3a'),
    ast: sumOf('ast') / n, tov: sumOf('tov') / n,
    at: sumOf('ast') / (sumOf('tov') || 1),
    ddG: ddRows.reduce((s, p) => s + p.dd / p.gp, 0) / (ddRows.length || 1),
  };
}

const f = (v) => (isNum(v) ? v : null);
/** Raw per-category value fed to the z-score. Missing stays null (never coerced to 0). */
export function catValue(p, k, r) {
  switch (k) {
    case 'PTS': return f(p.pts);
    case '3PM': return f(p.pm3);
    case 'FTM': return f(p.ftm);
    case 'REB': return f(p.reb);
    case 'AST': return f(p.ast);
    case 'STL': return f(p.stl);
    case 'BLK': return f(p.blk);
    case 'TOV': return f(p.tov);
    case 'DD': return isNum(p.dd) && p.gp > 0 ? p.dd / p.gp : null;       // DD is a season total -> per game
    case 'A/T': return f(p.at);
    case 'FG%': return isNum(p.fg) && isNum(p.fga) && r.fg !== null ? (p.fg - r.fg) * p.fga : null;
    case 'FT%': return isNum(p.ft) && isNum(p.fta) && r.ft !== null ? (p.ft - r.ft) * p.fta : null;
    case '3P%': return isNum(p.p3) && isNum(p.p3a) && r.p3 !== null ? (p.p3 - r.p3) * p.p3a : null;
    default: return null; // TD and unknown keys are never scored
  }
}

export const activeCats = (weights) => SCORING_CATS.filter((k) => (Number(weights[k]) || 0) > 0);

/**
 * Build the whole analysis model for a player universe.
 * @param {object[]} players   normalized player records
 * @param {{weights:object,minGP:number,refMode:string,selected:Iterable<string>}} cfg
 */
export function buildModel(players, cfg) {
  const { weights, minGP, refMode } = cfg;
  const selected = new Set(cfg.selected || []);
  const basePool = referencePool(players, { minGP, refMode });
  const usable = basePool.length >= RULES.minPool;
  const status = usable
    ? { ok: true, poolSize: basePool.length }
    : { ok: false, poolSize: basePool.length, reason: `參考池只有 ${basePool.length} 位合格球員（至少需要 ${RULES.minPool} 位），Fit 與強弱分數暫不可用。請同步或匯入完整球季資料。` };
  const r = refStats(basePool);
  const stats = {}; const zs = {};
  const cats = activeCats(weights);
  if (usable) {
    for (const k of cats) {
      let pool = basePool;
      if (k === 'FG%' || k === 'FT%' || k === '3P%') pool = basePool.filter((p) => (p.baselineGp ?? p.gp) >= RULES.pctBaselineGp);
      const rk = refStats(pool);
      const vs = pool.map((p) => catValue(p, k, rk)).filter(Number.isFinite).map((v) => v * CATS[k].dir);
      const mom = robustMoments(vs);
      stats[k] = mom;
      const m = new Map();
      for (const p of players) {
        const v = catValue(p, k, rk);
        m.set(p.name, Number.isFinite(v) ? clamp(((v * CATS[k].dir) - mom.mean) / mom.sd, -RULES.zClamp, RULES.zClamp) : null);
      }
      zs[k] = m;
    }
  }
  const team = players.filter((p) => selected.has(p.name));
  const model = { status, pool: basePool, r, stats, zs, cats, weights: { ...weights }, team, strength: {} };
  model.strength = teamStrength(team, model);
  return model;
}

/** Category strength for an arbitrary team (also used by What-if). z = sum(z) / sqrt(team size). */
export function teamStrength(team, model) {
  const out = {};
  for (const k of Object.keys(model.stats)) {
    const arr = team.map((p) => model.zs[k].get(p.name)).filter(Number.isFinite);
    const z = team.length ? arr.reduce((s, v) => s + v, 0) / Math.sqrt(team.length) : 0;
    out[k] = { z, index: RULES.neutral + RULES.strengthSpread * Math.tanh(z / RULES.strengthTanhDiv) };
  }
  return out;
}

/** Base Fit: weighted mean z across active categories (player's own value, team-agnostic). */
export function baseFit(p, model) {
  let s = 0; let m = 0;
  for (const k of model.cats) {
    const z = model.zs[k]?.get(p.name);
    if (!Number.isFinite(z)) continue;
    s += z * model.weights[k]; m += model.weights[k];
  }
  return m ? s / m : 0;
}

/** Team Fit: like Base Fit but weak categories of the current team are up-weighted, strong ones down-weighted. */
export function teamFit(p, model) {
  let s = 0; let m = 0;
  for (const k of model.cats) {
    const z = model.zs[k]?.get(p.name);
    if (!Number.isFinite(z)) continue;
    const need = model.strength[k]?.z || 0;
    const factor = need < 0 ? 1 + Math.min(1.5, -need / 2.5) : Math.max(0.55, 1 - need / 6);
    s += z * model.weights[k] * factor; m += model.weights[k] * factor;
  }
  return m ? s / m : 0;
}

export const fitIndex = (x) => clamp(RULES.neutral + RULES.fitSpread * x, 0, 100);

/** True when the player has at least one finite z (i.e. a Fit score is meaningful). */
export const hasFit = (p, model) => model.status.ok && model.cats.some((k) => Number.isFinite(model.zs[k]?.get(p.name)));

export const fitTone = (idx) => (idx >= RULES.fitStrong ? 'strong' : idx < RULES.fitWeak ? 'weak' : 'mid');
export const cellTone = (model, p, cat) => {
  if (!CATS[cat]?.score || !(model.weights[cat] > 0)) return 'neutral';
  const z = model.zs[cat]?.get(p.name);
  if (!Number.isFinite(z)) return 'neutral';
  return z >= RULES.tintZ ? 'good' : z <= -RULES.tintZ ? 'bad' : 'neutral';
};

/** Category strength summary: weakest first, plus weak / strong lists (thresholds from V4.0.21). */
export function strengthSummary(model) {
  const entries = model.cats.map((k) => ({ k, idx: model.strength[k]?.index ?? RULES.neutral, z: model.strength[k]?.z ?? 0 }));
  entries.sort((a, b) => a.idx - b.idx);
  const weak = entries.filter((x) => x.idx < RULES.weakIdx).slice(0, 3).map((x) => x.k);
  const strong = entries.filter((x) => x.idx > RULES.strongIdx).slice(-3).map((x) => x.k);
  return { entries, weak, strong };
}
