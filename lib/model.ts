// Token Radar — the radar-2 model (Node 22, standard library only).
//
// What this model claims: if a protocol that records no token issued one
// tomorrow and its record stayed as it is, what would that token be worth?
// It never predicts whether or when a token is issued. Every number below
// comes from the snapshot's own figures: a protocol's TVL, its seven-day
// growth, how long it has run, how many chains it runs on, and the market
// caps of the protocols whose tokens already trade.
//
// Pricing: for each category with at least four live-token protocols, the
// category ratio is the median market-cap-over-TVL of those protocols.
// Any other category falls back to the global median across all live-token
// protocols. Ratios are clamped to [0.05, 1.00] so one outlier cannot set a
// category's price. A protocol is "live" when its recorded market cap is a
// positive number; a market cap of exactly zero (or a dust negative) means
// no market trades it, so it cannot price a category.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelMultipliers {
  category_ratio: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number;
  implied_value_usd: number;
  model: ModelMultipliers;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface ComparableRow {
  category: string;
  ratio: number;
  live_n: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: 'radar-2';
  model: typeof MODEL;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_ratio: number;
  comparables: ComparableRow[];
  rows: BoardRow[];
  live: LiveRow[];
}

export interface Radar {
  board: BoardRow[];
  radar: RadarData;
}

/** The model's constants, stated once so the dashboard can re-derive them. */
export const MODEL = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.01,
  chain_max_extra: 9,
  ratio_floor: 0.05,
  ratio_cap: 1.0,
  min_live_for_category: 4,
} as const;

/** Read and validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw !== 'object' || raw === null) throw new Error('snapshot is not an object');
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot.protocols is not an array');
  if (!Array.isArray(raw.watchlist)) throw new Error('snapshot.watchlist is not an array');
  if (typeof raw.as_of !== 'string' || typeof raw.source !== 'string') {
    throw new Error('snapshot is missing as_of or source');
  }
  if (typeof raw.floor_usd !== 'number' || raw.floor_usd <= 0) {
    throw new Error('snapshot.floor_usd is not a positive number');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || p.slug === '') throw new Error('protocol without a slug');
    if (typeof p.name !== 'string' || p.name === '') throw new Error(`protocol ${p.slug} without a name`);
    if (typeof p.tvl_usd !== 'number' || p.tvl_usd < 0) throw new Error(`protocol ${p.slug} has a bad tvl_usd`);
    if (!Array.isArray(p.chains)) throw new Error(`protocol ${p.slug} has no chains array`);
  }
  return raw;
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol's token trades when its recorded market cap is positive. */
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

// Categories the watchlist rule itself excludes: a wrapped, staked or
// bridged product of a protocol whose token already trades is not a launch.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// A version marker at the end of a name: "Foo V2", "Foo v2", "Foo 2.0".
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Whole words that mark a wrapped or staked product of an existing token.
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The watchlist's own exclusion rule, applied to early rows too: a
 * pre-token protocol is rankable unless its category is excluded, its name
 * ends in a version marker, carries a wrapped/staked word, or begins with
 * an exchange's name. No protocol is ever special-cased by name.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

/** Whole days from listed_at to as_of; null means the model assumes 365. */
export function ageDays(p: SnapshotProtocol, asOf: Date): number {
  if (p.listed_at === null) return MODEL.unknown_age_days;
  const listed = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  const days = Math.floor((asOf.getTime() - listed) / 86_400_000);
  return days < 0 ? 0 : days;
}

/** Median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function clampRatio(ratio: number): number {
  return Math.min(MODEL.ratio_cap, Math.max(MODEL.ratio_floor, ratio));
}

/**
 * The comparables: per-category median market-cap-over-TVL over live-token
 * protocols, for categories with at least four of them, plus the global
 * median every other category falls back to. Computed from the snapshot,
 * never hardcoded.
 */
export function computeComparables(snapshot: Snapshot): {
  byCategory: Map<string, number>;
  globalRatio: number;
  table: ComparableRow[];
} {
  const live = snapshot.protocols.filter(isLive);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const globalRatio = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const priced = new Map<string, number>();
  const table: ComparableRow[] = [];
  for (const category of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(category)!;
    if (ratios.length < MODEL.min_live_for_category) continue;
    const ratio = clampRatio(median(ratios));
    priced.set(category, ratio);
    table.push({ category, ratio, live_n: ratios.length });
  }
  return { byCategory: priced, globalRatio, table };
}

/**
 * The implied value, step by step:
 *   base     = TVL x category ratio (clamped)
 *   growth   = 1 + clamp(change_7d, -50, +100) / 100 x 0.6
 *   maturity = 0.70 + min(age, 1095) / 1095 x 0.30
 *   chains   = 1 + min(chains - 1, 9) x 0.01
 *   implied  = max(1, round(base x growth x maturity x chains))
 */
export function impliedValue(
  p: SnapshotProtocol,
  ratio: number,
  asOf: Date,
): { value: number; model: ModelMultipliers } {
  const growthPct = p.change_7d === null ? 0 : Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, p.change_7d));
  const age = ageDays(p, asOf);
  const model: ModelMultipliers = {
    category_ratio: ratio,
    growth_pct: growthPct,
    growth_multiplier: 1 + (growthPct / 100) * MODEL.growth_weight,
    maturity_multiplier: MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range,
    chain_multiplier: 1 + Math.min(p.chains.length - 1, MODEL.chain_max_extra) * MODEL.chain_step,
    age_days: age,
  };
  const base = p.tvl_usd * ratio;
  const value = Math.max(1, Math.round(base * model.growth_multiplier * model.maturity_multiplier * model.chain_multiplier));
  return { value, model };
}

// Capital by TVL tier for the farm plan's main step.
function farmCapital(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 10_000_000) return 100;
  return 50;
}

// The category action, matched on a lowercase category substring; the first
// hit wins. Every action names the protocol, the capital and the chain.
const CATEGORY_ACTIONS: Array<[string[], (name: string, capital: number, chain: string) => string]> = [
  [['lend', 'cdp', 'collateral'], (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open, borrowing a little against it once`],
  [['dex', 'leveraged farm', 'liquidity manager'], (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open through one rebalance`],
  [['yield aggregator', 'yield'], (n, c, ch) => `Deposit $${c} of USDC into ${n}'s highest-TVL vault on ${ch} and leave the shares in place`],
  [['staking', 'restak'], (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt token in your wallet`],
  [['perpetual', 'derivative', 'basis trad'], (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge, then close it after a week`],
  [['prediction'], (n, c, ch) => `Fund $${c} and place one market position on ${n}, then settle it when the market closes`],
  [['curator', 'allocator', 'risk'], (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares for the full lock period`],
  [['stable'], (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold it in your wallet`],
  [['rwa'], (n, c, ch) => `Mint $${c} of the protocol's yield-bearing asset on ${ch} and hold it for the full term`],
  [['insurance'], (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy until it expires`],
  [['payment', 'card'], (n, c, ch) => `Spend $${c} through ${n} on ${ch} and keep the receipt in the app`],
  [['farm'], (n, c, ch) => `Deposit $${c} into ${n}'s farm on ${ch} and harvest the rewards weekly`],
  [['index'], (n, c, ch) => `Buy $${c} of the ${n} index token on ${ch} and hold it`],
  [['chain'], (n, c, ch) => `Bridge $${c} of USDC to ${n} and use it in one of its native apps`],
  [['btc'], (n, c, ch) => `Deposit $${c} of BTC through ${n} on ${ch} and keep the position open`],
];

function categoryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const [needles, build] of CATEGORY_ACTIONS) {
    if (needles.some((needle) => category.includes(needle))) return build(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open`;
}

/**
 * Six concrete farm steps for one protocol, derived from its own record:
 * category, chains, TVL and age. Each step carries what it costs and how
 * long it takes, and says nothing the snapshot cannot support.
 */
export function farmSteps(p: SnapshotProtocol, age: number): string[] {
  const capital = farmCapital(p.tvl_usd);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = capital >= 150 ? '~$8' : '~$4';
  const holdDays = age < 180 ? 60 : age < 365 ? 45 : 30;
  return [
    `Set up a fresh wallet for ${p.name} and write the seed phrase on paper, stored offline, never in a screenshot or a chat. Cost: under $3 gas. Time: 5 min.`,
    `${categoryAction(p, capital, chain)}. Cost: ${gas} gas plus the $${capital} you keep in the position. Time: 15 min.`,
    `Return once a week and do one qualifying action on ${p.name} — a deposit, a borrow, a swap or a vote — so the wallet stays active. Cost: ~$2 gas a week. Time: 10 min a week.`,
    `Hold the position for at least ${holdDays} days before you touch it, so the activity reads as a real user and not a one-day farm. Cost: nothing. Time: ${holdDays} days.`,
    `Before you withdraw anything, open ${p.name}'s own points or rewards page from the link the protocol itself publishes and claim only from there; never pay anyone to claim for you. Cost: nothing. Time: 10 min.`,
    `Write down the wallet, every date and every transaction hash for ${p.name} in one place, so you can prove the activity later. Cost: nothing. Time: 5 min.`,
  ];
}

/** Build the board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): Radar {
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`);
  const { byCategory, globalRatio, table } = computeComparables(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const floor = snapshot.floor_usd;

  const scored: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    const onWatchlist = watchlist.has(p.slug);
    // The board is the whole watchlist, plus every rankable pre-token
    // protocol below the floor. Protocols above the floor that the
    // watchlist leaves out are arms of a larger protocol, not launches
    // of their own, so they stay off the board.
    if (!onWatchlist && !(p.tvl_usd < floor && isRankable(p))) continue;
    if (!onWatchlist && !isPreToken(p)) continue;
    const ratio = p.category !== null && byCategory.has(p.category) ? byCategory.get(p.category)! : globalRatio;
    const { value, model } = impliedValue(p, ratio, asOf);
    const age = model.age_days;
    scored.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      watchlist: onWatchlist,
      age_days: age,
      implied_value_usd: value,
      model,
      farm_steps: farmSteps(p, age),
    });
  }

  // Rank by implied value, highest first; ties break by slug so the order
  // is deterministic and the program runs twice with the same bytes.
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  // The live tokens, set apart: the top 24 by market cap, shown at the
  // market's own value. They are also the comparables the board is priced
  // from, so the page can say so honestly.
  const live = snapshot.protocols
    .filter(isLive)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));

  const earlySize = scored.filter((row) => !row.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-2',
    model: MODEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: scored.length,
    early_size: earlySize,
    live_size: live.length,
    global_ratio: globalRatio,
    comparables: table,
    rows: scored,
    live,
  };
  return { board: scored, radar };
}

/**
 * The gate's own rules, checked before anything is written: full watchlist
 * coverage, ranks exactly 1..N, implied values non-increasing with rank,
 * not all equal, every farm step 3–12 strings of 20–600 characters, every
 * slug one of the snapshot's protocols, every implied value a positive
 * whole number. Returns the first problem, or null when the board is clean.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const watchlist = new Set(snapshot.watchlist);
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  let previous: number | null = null;
  let allEqual = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${row.slug} is not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `row ${row.slug} has an implied value that is not a positive whole number`;
    }
    if (previous !== null && row.implied_value_usd > previous) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
    if (previous !== null && row.implied_value_usd !== previous) allEqual = false;
    previous = row.implied_value_usd;
    if (typeof row.name !== 'string' || row.name.trim() === '') return `row ${row.slug} has no name`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${row.farm_steps?.length ?? 0} farm steps, the gate wants 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters, the gate wants 20 to 600`;
      }
    }
  }
  if (allEqual && board.length >= 2) return 'every implied value is the same: the board ranks nothing';
  for (const slug of watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data, as a script the page loads beside itself. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
