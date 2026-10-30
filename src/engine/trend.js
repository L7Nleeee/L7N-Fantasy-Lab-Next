// Trend analysis: compare two datasets (e.g. recent10 vs current) for the same player to produce per-category tags.
// Pure functions only — no DOM, no storage.
import { isNum } from './util.js';
import { H2H_RAW_KEY } from './schema.js';

// Thresholds for tagging. Positive = this category is better in "recent" vs "baseline".
// TOV is reversed: a LOWER recent TOV means the player is improving.
const SURGE   = 0.25;   // >=25% better  -> 🔥 爆發
const UP      = 0.10;   // >=10% better  -> 📈 上揚
const DOWN    = -0.10;  // <=-10% worse  -> 📉 下滑
const COLD    = -0.25;  // <=-25% worse  -> 🧊 低潮

const CAT_FIELD = {         // how to get a per-game value from a player record
  PTS:   (p) => p.pts,   '3PM': (p) => p.pm3,  FTM:  (p) => p.ftm,
  REB:   (p) => p.reb,   AST:   (p) => p.ast,  STL:  (p) => p.stl,
  BLK:   (p) => p.blk,   TOV:   (p) => p.tov,  DD:   (p) => (isNum(p.dd) && p.gp > 0 ? p.dd / p.gp : null),
  'FG%': (p) => p.fg,   'FT%': (p) => p.ft,   '3P%': (p) => p.p3,  'A/T': (p) => p.at,
};
const REVERSE_CATS = new Set(['TOV']);   // lower is better → flip the ratio

export const TREND_CATS = Object.keys(CAT_FIELD);

/** @returns {{ cat:string, rel:number, tag:'surge'|'up'|'down'|'cold'|null }[]} */
export function playerTrend(recent, baseline) {
  if (!recent || !baseline) return [];
  return TREND_CATS.map((cat) => {
    const r = CAT_FIELD[cat](recent);
    const b = CAT_FIELD[cat](baseline);
    if (!isNum(r) || !isNum(b) || b === 0) return { cat, rel: null, tag: null };
    const raw = (r - b) / Math.abs(b);
    const rel = REVERSE_CATS.has(cat) ? -raw : raw;           // for TOV: recent < baseline -> positive = better
    const tag = rel >= SURGE ? 'surge' : rel >= UP ? 'up' : rel <= COLD ? 'cold' : rel <= DOWN ? 'down' : null;
    return { cat, rel, tag };
  }).filter((x) => x.tag !== null || x.rel !== null);
}

const EMOJI = { surge: '🔥', up: '📈', down: '📉', cold: '🧊' };
const LABEL = { surge: '爆發', up: '上揚', down: '下滑', cold: '低潮' };
const TONE  = { surge: 'green', up: 'green', down: 'amber', cold: 'red' };

/** Human-readable summary of the most notable trends (up to 2 pos + 1 neg, avoiding clutter). */
export function trendSummary(trends) {
  const pos = trends.filter((t) => t.tag === 'surge' || t.tag === 'up').sort((a, b) => b.rel - a.rel);
  const neg = trends.filter((t) => t.tag === 'cold' || t.tag === 'down').sort((a, b) => a.rel - b.rel);
  return { pos: pos.slice(0, 2), neg: neg.slice(0, 1), hasData: trends.length > 0 };
}

/** Build a Map<name, {trends, summary, overallTag}> for a list of players, given two universes. */
export function buildTrendMap(players, recentUniverse, baselineUniverse) {
  const byName = (u) => new Map((u?.players ?? []).map((p) => [p.name, p]));
  const rec = byName(recentUniverse); const base = byName(baselineUniverse);
  const result = new Map();
  for (const p of players) {
    const r = rec.get(p.name); const b = base.get(p.name);
    if (!r?.pts || !b?.pts) { result.set(p.name, null); continue; }
    const trends = playerTrend(r, b);
    const summary = trendSummary(trends);
    const surges = trends.filter((t) => t.tag === 'surge');
    const overallTag = surges.length >= 2 ? 'surge' : summary.pos.length >= 1 && summary.neg.length === 0 ? 'up'
      : summary.neg.length >= 1 && summary.pos.length === 0 ? (trends.some((t) => t.tag === 'cold') ? 'cold' : 'down')
      : null;
    result.set(p.name, { trends, summary, overallTag, recent: r, baseline: b });
  }
  return result;
}

/** HTML badge(s) for inline display next to a player name. */
export function trendBadgeHtml(info) {
  if (!info) return '';
  const { summary, overallTag } = info;
  const parts = [];
  if (overallTag === 'surge') parts.push(`<span class="trend-tag t-surge">${EMOJI.surge} 近況爆發</span>`);
  else if (overallTag === 'cold') parts.push(`<span class="trend-tag t-cold">${EMOJI.cold} 近況低潮</span>`);
  else {
    for (const t of summary.pos) parts.push(`<span class="trend-tag t-${TONE[t.tag]}">${EMOJI[t.tag]} ${t.cat} ${LABEL[t.tag]}</span>`);
    for (const t of summary.neg) parts.push(`<span class="trend-tag t-${TONE[t.tag]}">${EMOJI[t.tag]} ${t.cat} ${LABEL[t.tag]}</span>`);
  }
  return parts.join('');
}

/** Rank free-agent candidates by their value for THIS week against the given opponent.
 *  "Value" = how many of the MY losing categories this player can flip, weighted by gap magnitude.
 *  @param {object[]} candidates   players NOT in my roster or opp (the free agent pool)
 *  @param {object[]} myTeam       my current roster players (for weekly totals)
 *  @param {object|null} oppTotal  output of teamTotals() for the opponent
 *  @param {string[]} lossCats     H2H category labels I am losing (e.g. ['FT%','3PM'])
 *  @param {object} weeklyCtx
 *  @param {number} [maxGames]     max projected games this week (for schedule filter)
 */
export function rankFAPickups({ candidates, myTeam, oppTotals, lossCats, weeklyCtx, h2hCats, topN = 8 }) {
  if (!candidates.length || !lossCats.length) return [];
  const { teamTotals, projectedGames, h2hRows, h2hRecord } = globalThis.__weeklyEngine || {};
  if (!teamTotals) return [];                     // engine injected at boot (avoids circular import in pure module)

  const myBase = teamTotals(myTeam, weeklyCtx);
  const scored = candidates.map((p) => {
    const g = projectedGames(p, weeklyCtx).games;
    if (g === 0 || p.status === 'no-data' || p.status === 'no-games') return null;
    // simulate adding this player to my team
    const simTeam = [...myTeam, p];
    const simTotal = teamTotals(simTeam, weeklyCtx);
    let score = 0; const boosts = [];
    for (const label of lossCats) {
      const key = H2H_RAW_KEY[label]; if (!key) continue;
      const before = myBase.raw[key]; const after = simTotal.raw[key];
      if (!isNum(before) || !isNum(after)) continue;
      const delta = label === 'TOV' ? before - after : after - before;   // positive = improvement
      if (delta > 0) { score += delta * (label === 'TOV' ? 0.5 : 1); boosts.push({ label, delta }); }
    }
    if (score === 0) return null;
    // bonus: simulate full H2H record change
    let recordDelta = 0;
    if (oppTotals) {
      const before = h2hRecord(h2hRows(myBase, oppTotals, new Set(h2hCats)));
      const after  = h2hRecord(h2hRows(simTotal, oppTotals, new Set(h2hCats)));
      recordDelta = after.w - before.w;
    }
    return { p, score, boosts: boosts.sort((a, b) => b.delta - a.delta), recordDelta, games: g };
  }).filter(Boolean);

  return scored.sort((a, b) => b.recordDelta - a.recordDelta || b.score - a.score).slice(0, topN);
}
void EMOJI;
