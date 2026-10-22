# Architecture and performance review

Branch: `refactor/architecture-performance`, starting at `8c47796`.

## Reproduce measurements

Run `bun scripts/benchmark.ts` from the repository root, or pass case names to
measure one change in isolation. Each case checks its result, warms up once and
reports five samples plus median/min/max in milliseconds. Run benchmarks without
other test/build jobs. These are local synthetic timings, not production SLAs.

Baseline environment: macOS arm64, Bun 1.3.13, DuckDB node-api 1.5.3-r.1.
Workloads include 10,000 formatted values, a 10,000-row typed import, and the full
Maven sample dashboard with 62,884 sales lines. Concurrent means four dashboard
requests to one engine, without persistent result caching.

## Measurement ledger

| Change / workload                           | Baseline median (range)   | Result median (range)  | Decision |
| ------------------------------------------- | ------------------------- | ---------------------- | -------- |
| Reuse Intl number formatters, 10,000 values | 183.19 (179.94–186.68)    | 4.16 (4.08–4.23)       | Keep     |
| Reuse Intl date formatters, 10,000 values   | 1035.79 (1025.89–1040.86) | 4.01 (3.89–4.59)       | Keep     |
| Import 10,000 rows                          | 906.00 (889.83–948.70)    | 107.71 (103.53–121.34) | Keep     |
| Maven overview                              | 891.12 (884.44–900.77)    | Pending                | Baseline |
| Four concurrent Maven overviews             | 916.72 (911.74–928.30)    | Pending                | Baseline |

### Formatter reuse

`formatValue` owns bounded caches of Intl instances, with at most 64 entries for
numbers and 64 for dates. Keys include every effective formatting option and
locale. No cell values or query results are cached. Tests compare outputs against
Intl across more than 64 combinations, and preserve UTC dates, invalid dates,
nulls, booleans, text and invalid-option errors. The change benefits table cells,
metrics and chart labels without adding cache management to their callers.

## Remaining review

- Review query resource lifetime, repeated mounts and request isolation.
- Review renderer responsibilities and chart update/disposal behavior.
- Check production bundles, browser behavior and the complete test suite.

### Bound row batches

`mountRows` now inserts up to 256 rows per prepared statement, limited to 2,048
placeholders for normal-width tables. A wider-than-limit row is inserted alone.
Only two statement shapes are needed, the full batch and its remainder. Values
remain bound parameters and DuckDB still performs explicit type casts. Tests
cover multiple batches, exact large integers, dates, timestamps, mixed columns,
nulls, SQL-looking text and empty imports. Own-property lookup also fixes valid
column names such as `constructor` and `toString`.
