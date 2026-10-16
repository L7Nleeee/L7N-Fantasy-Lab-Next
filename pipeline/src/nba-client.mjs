// NBA Stats source adapter. IMPORTANT: stats.nba.com has no public SLA and often blocks cloud runners.
// This client is deliberately restrained (sequential requests, gap between calls, bounded retries with exponential backoff + jitter)
// and classifies failures so the pipeline can fail visibly instead of publishing partial data.
import { sleep } from './util.mjs';

const BASE = 'https://stats.nba.com/stats';
export const SEASON_TYPE = 'Regular%20Season';

export const gameLogUrl = (season) => `${BASE}/leaguegamelog?Counter=0&DateFrom=&DateTo=&Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=${season}&SeasonType=${SEASON_TYPE}&Sorter=DATE`;
export const dashTotalsUrl = (season) => `${BASE}/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=Totals&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=${season}&SeasonSegment=&SeasonType=${SEASON_TYPE}&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&Weight=`;
export const allPlayersUrl = (season) => `${BASE}/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=${season}`;

export const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com',
  'x-nba-stats-origin': 'stats', 'x-nba-stats-token': 'true',
};

/** kind: blocked | rate-limited | http | timeout | network | malformed */
export class SourceError extends Error {
  constructor(kind, message, { url, status, attempts } = {}) { super(message); this.name = 'SourceError'; this.kind = kind; this.url = url; this.status = status; this.attempts = attempts; }
}

/** Fetch JSON with timeout + bounded retries. 403 (blocked) is not retried: hammering a block makes it worse. */
export async function fetchJson(url, { fetchImpl = globalThis.fetch, retries = 3, baseDelayMs = 2000, timeoutMs = 30000, headers = NBA_HEADERS, sleepFn = sleep, random = Math.random, onAttempt } = {}) {
  let last;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      onAttempt?.({ url, attempt });
      const res = await fetchImpl(url, { headers, signal: ctl.signal });
      clearTimeout(timer);
      if (res.status === 403) throw Object.assign(new SourceError('blocked', `HTTP 403: the source refused this client (cloud IPs are often blocked)`, { url, status: 403, attempts: attempt }), { retryable: false });
      if (res.status === 429) throw Object.assign(new SourceError('rate-limited', 'HTTP 429: rate limited', { url, status: 429, attempts: attempt }), { retryable: true });
      if (res.status >= 500) throw Object.assign(new SourceError('http', `HTTP ${res.status}`, { url, status: res.status, attempts: attempt }), { retryable: true });
      if (!res.ok) throw Object.assign(new SourceError('http', `HTTP ${res.status}`, { url, status: res.status, attempts: attempt }), { retryable: false });
      let json;
      try { json = await res.json(); } catch { throw Object.assign(new SourceError('malformed', 'Response was not valid JSON', { url, attempts: attempt }), { retryable: true }); }
      return json;
    } catch (e) {
      clearTimeout(timer);
      const err = e instanceof SourceError ? e : new SourceError(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? `Timed out after ${timeoutMs} ms` : String(e?.message || e), { url, attempts: attempt });
      const retryable = e instanceof SourceError ? e.retryable : true;
      last = err; err.attempts = attempt;
      if (!retryable || attempt > retries) throw err;
      await sleepFn(baseDelayMs * 3 ** (attempt - 1) + Math.floor(random() * 500));
    }
  }
  throw last;
}

/** NBA result-set JSON -> array of {HEADER: value}. Throws SourceError('malformed') on any shape problem. */
export function parseResultSet(json, { requiredHeaders = [], name } = {}) {
  const sets = json?.resultSets ?? (json?.resultSet ? [json.resultSet] : null);
  const set = Array.isArray(sets) ? (name ? sets.find((s) => s.name === name) : sets[0]) : null;
  if (!set || !Array.isArray(set.headers) || !Array.isArray(set.rowSet)) throw new SourceError('malformed', 'Unexpected response shape (no resultSet headers/rowSet)');
  const missing = requiredHeaders.filter((h) => !set.headers.includes(h));
  if (missing.length) throw new SourceError('malformed', `Response is missing expected columns: ${missing.join(', ')}`);
  return set.rowSet.map((r) => Object.fromEntries(set.headers.map((h, i) => [h, r[i]])));
}

export const GAMELOG_HEADERS = ['PLAYER_ID', 'PLAYER_NAME', 'TEAM_ABBREVIATION', 'GAME_ID', 'GAME_DATE', 'MIN', 'FGM', 'FGA', 'FG3M', 'FG3A', 'FTM', 'FTA', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PTS'];
export const DASH_HEADERS = ['PLAYER_ID', 'PLAYER_NAME', 'GP', 'FGM', 'FGA', 'FTM', 'FTA', 'FG3M', 'FG3A', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PTS'];
export const ROSTER_HEADERS = ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'TEAM_ABBREVIATION'];

/** Sequential client with a pause between requests. `fetchImpl`, `sleepFn` and `random` are injectable for tests. */
export function createNbaClient({ fetchImpl = globalThis.fetch, gapMs = 1500, sleepFn = sleep, ...opts } = {}) {
  let first = true;
  const call = async (url, parseOpts) => { if (!first) await sleepFn(gapMs); first = false; return parseResultSet(await fetchJson(url, { fetchImpl, sleepFn, ...opts }), parseOpts); };
  return {
    gameLog: (season) => call(gameLogUrl(season), { requiredHeaders: GAMELOG_HEADERS }),
    dashTotals: (season) => call(dashTotalsUrl(season), { requiredHeaders: DASH_HEADERS }),
    allPlayers: (season) => call(allPlayersUrl(season), { requiredHeaders: ROSTER_HEADERS }),
  };
}

/** Offline client backed by a saved response bundle ({gameLog:{season:json}, dash:{season:json}, allPlayers:json}); enforces the same column checks as the live client. */
export function createFixtureClient(fx) {
  return {
    gameLog: async (s) => parseResultSet(fx.gameLog[s], { requiredHeaders: GAMELOG_HEADERS }),
    dashTotals: async (s) => parseResultSet(fx.dash[s], { requiredHeaders: DASH_HEADERS }),
    allPlayers: async () => parseResultSet(fx.allPlayers, { requiredHeaders: ROSTER_HEADERS }),
  };
}
