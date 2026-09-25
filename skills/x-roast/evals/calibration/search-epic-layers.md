# Epic — Product search

## Outcome
A customer who types a product name finds it on the first results page. Today 31% of sessions that
open the catalog leave without viewing a product (analytics, last 30 days); search should bring that
under 25%.

## Slices
**S1 — Name search, end to end.** A search box on the catalog page queries product names
(`ILIKE` on the existing table) and lists matches.
Acceptance: `GET /search?q=mug` returns every product with "mug" in its name; the page shows them;
`npm run e2e -- search-basic` passes.

**S2 — Relevance.** Replace `ILIKE` with Postgres full-text search, ranked, with typo tolerance
through `pg_trgm`.
Acceptance: the 50 queries in `fixtures/search-golden.json` return their expected product in the
top 5 (today with S1: 29 of 50); S1's e2e still passes.

**S3 — Filters.** Category and price filters on the results.
Acceptance: `npm run e2e -- search-filters`; a filtered query's count matches the SQL count in the
fixture.

**S4 — Speed.** p95 under 200 ms at 50 requests/s against a copy of production data.
Acceptance: `k6 run load/search.js` reports p95 < 200 ms.

Each slice ships alone: S1 is useful on its own, and S2–S4 each improve a working search.

## Estimates
S1 2 d, S2 3 d, S3 2 d, S4 2 d — from the catalog filter work last quarter (5 d for a comparable
list, filter and page).

## Risk
Full-text ranking may not fit product names well (short strings). S2's golden set is the check; if
it stays under 40 of 50, fall back to trigram ranking alone.

## Measure
Catalog exit rate, weekly, for four weeks after S2 ships.
