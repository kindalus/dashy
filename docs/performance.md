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

## Final review, 2026-10-22

The final benchmark run confirmed the earlier measurements, with medians of
4.19 ms for numbers, 3.78 ms for dates, 101.09 ms for imports, 704.80 ms for the
Maven overview and 726.39 ms for four concurrent overviews. These runs use the
same assertions and workloads as the baseline; no test or result was removed
to obtain the improvements.

Validation completed:

- `bun test tests`: 57 passed, 0 failed, 2,370 assertions. Coverage includes
  all six source formats, parameter and permission contracts, cross-request
  isolation, nulls, truncation, query sharing, source freshness and Maven totals.
- `bun run typecheck` and `bun run build`: passed.
- `bun run check:build`: passed outside the source tree, exercising the packaged
  CLI, default project, runtime sample discovery, APIs, SSR, asset availability,
  all five themes, theme overrides and startup failures.
- Browser checks above passed on the production build. Performance observations
  are local synthetic results; production traffic was not measured.

The architecture review covered configuration/CLI loading, HTTP and SSR entry
points, engine authorization and query orchestration, source mounting, and client
rendering. Database lifetime now belongs to the request, and renderer lifetime
belongs to the visible chart. Existing project definitions and public engine
calls remain compatible. Data and authentication stay on the server; browser
rendering receives only the catalog and results. No dependencies were added.

Further changes considered but not implemented:

- Persistent data/result caches or shared database pools would require freshness
  and principal-isolation policies. The measured gains above do not depend on
  stale data or sharing mutable connections across requests.
- Materializing every CSV/Parquet source before querying could reduce repeated
  scans, but also copies unused columns/rows and removes native scan pushdown.
  Keep native views until workloads justify that memory/I/O tradeoff.
- Parallelizing dashboard queries would complicate connection ownership and
  increase resource demand. Request concurrency already remains isolated and
  is covered by the benchmark.
- Table virtualization would add complexity to tables that render eight rows per
  page. Further file splitting or layout lookup caches have no demonstrated
  benefit for the existing small dashboards.

No remaining change was justified by the reviewed architecture and measured
workloads. Larger data, higher request concurrency or new chart types should
start a new measurement cycle rather than assuming these local results apply.

## Independent-loading review, 2026-10-22

Branch: `refactor/query-and-render-performance`, starting at `a10c070`.
The benchmark now explicitly uses `en-GB` for its historic formatter workloads,
so changing the application's default locale does not invalidate the fixed
output assertions. `maven-independent` exercises the browser's current request
plan: parallel groups, with shared-query blocks in one group. It checks all
blocks and the revenue total. The aggregate API remains a separate workload.

Baseline medians from five samples after one warm-up:

| Workload | Median ms | Range ms |
| --- | ---: | --- |
| Format 10,000 numbers | 4.16 | 4.08–4.18 |
| Format 10,000 dates | 4.05 | 3.92–4.53 |
| Import 10,000 rows | 107.19 | 103.38–117.11 |
| Maven aggregate dashboard | 729.54 | 717.17–734.58 |
| Four concurrent aggregate dashboards | 740.14 | 738.92–741.99 |
| Maven independent requests | 312.12 | 310.13–313.23 |

### Native row import

Replaced prepared INSERT batches with DuckDB's native appender, using the
installed Node API's `createAppender`, typed append methods and `closeSync`.
DuckDB still performs conversions to the declared target columns. Text stays
data, including SQL-looking strings and embedded NUL characters. The importer
yields every 2,048 rows so other requests and timers can run; the existing
100,000-row limit remains. The appender closes in `finally` on both success
and conversion failures.

The same 10,000-row benchmark improved from **107.19 ms (103.38–117.11)** to
**10.83 ms (10.63–11.59)**. A second run measured **11.10 ms (10.66–11.54)**.
Keep: approximately 90% less import time and less statement/batch management.
Tests cross native chunk boundaries, preserve exact BIGINT strings, safe
numeric integers, timestamps, nulls and mixed values, and verify that failed
conversions reject while leaving the connection usable.

Reference: [DuckDB Node API appender documentation](https://github.com/duckdb/duckdb-node-neo/blob/main/api/pkgs/%40duckdb/node-api/README.md#append-to-table).

### Request cancellation owns database work

Previously, changing filters aborted browser fetches but the server continued
mounting sources and running their queries. HTTP handlers now pass the request
signal through the engine to `QuerySession`. The session owns the deadline,
native interruption, cancellation checkpoints and listener cleanup. Adapters
receive the combined cancellation/deadline signal; existing adapters remain
compatible because the signal is optional. A cancelled request returns 499 if
a response can still be delivered, without logging the private abort reason.

Tests prove that pre-cancelled requests through all five data endpoint types
mount zero sources. Cancellation during a delayed adapter starts zero SQL
queries and zero later mounts. A running 10-billion-row range aggregate is
interrupted after the scheduled 50 ms while a separate session returns 42.
Completed sessions remove their abort listeners before closing. These are
avoided-work checks, not claims of lower normal-request latency.

The isolated packaged-deployment check also aborts a real HTTP fetch after its
adapter starts and verifies that the adapter receives cancellation. This tests
the Bun/Nitro transport as well as the engine. An uncooperative adapter cannot
be forcibly stopped, but no later query starts after it returns. Excel parsing
has the same limitation; row import checks the signal between chunks.
