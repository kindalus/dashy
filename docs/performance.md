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
| Maven overview                              | 891.12 (884.44–900.77)    | 699.41 (695.59–716.01) | Keep     |
| Four concurrent Maven overviews             | 916.72 (911.74–928.30)    | 733.43 (730.12–741.03) | Keep     |

### Formatter reuse

`formatValue` owns bounded caches of Intl instances, with at most 64 entries for
numbers and 64 for dates. Keys include every effective formatting option and
locale. No cell values or query results are cached. Tests compare outputs against
Intl across more than 64 combinations, and preserve UTC dates, invalid dates,
nulls, booleans, text and invalid-option errors. The change benefits table cells,
metrics and chart labels without adding cache management to their callers.

### Bound row batches

`mountRows` now inserts up to 256 rows per prepared statement, limited to 2,048
placeholders for normal-width tables. A wider-than-limit row is inserted alone.
Only two statement shapes are needed, the full batch and its remainder. Values
remain bound parameters and DuckDB still performs explicit type casts. Tests
cover multiple batches, exact large integers, dates, timestamps, mixed columns,
nulls, SQL-looking text and empty imports. Own-property lookup also fixes valid
column names such as `constructor` and `toString`.

### Request-owned query sessions

`QuerySession` owns lazy DuckDB initialization, mounting, per-query interruption,
materialization limits and cleanup. `DashyEngine` retains parameter validation,
authorization and presentation contracts. A dashboard reuses its connection and
source mounts across sequential queries; independent requests remain isolated.
Initialization failure closes the instance even if connecting fails.

The existing mount-count assertion changes from three to one because the source
now mounts once per dashboard, while a separate query-builder count still proves
that the three distinct queries execute exactly once. New tests cover concurrent
filter isolation, refresh freshness, denied queries without source access and
continued rendering after a query error. Existing Maven reconciliation and HTTP
permission tests also pass. No persistent result or source cache was added.

### Chart ownership

The Solid `Chart` component owns loading, reactive updates and unmount cleanup.
The lazy `charts` module owns ECharts registration, theme translation, options,
one renderer and its resize observer. Callers only update data or dispose the
renderer; they no longer handle ECharts options or resource allocation.

On the Maven overview, three refreshes previously allocated six new renderers.
The same three refreshes now keep both instance IDs, allocating none. Switching
to Table removes the chart; switching back creates one new instance while the
other chart keeps its ID. `notMerge` replaces options completely to avoid stale
series or settings when definitions change. It preserves the previous behavior
of resetting chart interaction state on refresh.

Chrome traces at 1440 × 1000 with reduced motion reported INP 57 ms before and
56 ms after, both with CLS rounded to 0.00. This is not a measurable latency win.
The reason to keep the refactor is explicit resource ownership and removal of
renderer/observer churn, not a claim of faster clicks. The total JavaScript size
stays essentially unchanged, about 621 kB before compression. ECharts stays lazy;
the initial entry is 74,097 bytes, plus an 845-byte shared formatter module.

Browser checks covered updated values with the Online filter, three refreshes,
chart/table switching, pagination, preserving Table while resetting to page one
on refresh, no-results filters and recovery, and resizing between 1440 and 390
pixels. SVG widths match their containers after resize; screenshots show both
charts and no horizontal page overflow. No console errors or warnings occurred.
