# Token Radar

A token launch radar: protocols that record no token, ranked by what a launch
would be worth if the protocol's record stayed as it is — plus a concrete farm
plan for each one. It never predicts whether or when a token is issued.

## The model (radar-2)

1. **Pre-token test.** A protocol is pre-token when its market cap, CoinGecko
   id and symbol are all null. The page says a protocol "records no token",
   never that it has none.
2. **Category ratio.** For each category with at least four live-token
   protocols, the ratio is the median of their market-cap-over-TVL ratios.
   Any other category falls back to the global median. Ratios are clamped to
   0.05–1.00.
3. **Implied value** = TVL × ratio × growth × maturity × chains:
   - growth = 1 + clamp(7d change, −50%, +100%) / 100 × 0.6
   - maturity = 0.70 + min(age, 1095) / 1095 × 0.30 (unknown age counts as 365 days)
   - chains = 1 + min(chains − 1, 9) × 0.01
4. **The board** ranks all 40 watchlist protocols plus every rankable
   pre-token protocol below the $50M floor — 178 rows. The 24 live-token
   protocols with the largest market caps sit apart, at the market's own
   value, and are the comparables the board is priced from.
5. **Farm plans.** Six steps per protocol, derived from its own category,
   chains, TVL and age, each with a cost and a time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only, no network, deterministic: two runs write
the same bytes. `main.ts` refuses to finish without three screenshots in
`screenshots/` (board, detail, filtered view) and writes `board.json`,
`data.js` and `dossier.json` into the output directory.

## Dashboard

`dashboard/` is a static page (no network, no framework): a sortable,
filterable board, a detail view per protocol that re-derives the implied
value and the farm plan in the page and checks them against `board.json`,
a live-tokens tab and a methodology tab. URL hash state (`#q=…&category=…&
chain=…&watchlist=1&sort=…&tab=…&p=<slug>`) makes every view linkable.

## Disclaimer

Implied values are this entry's own claim, from the snapshot's figures and
the model above — never a price, and never a promise that a token will launch.
