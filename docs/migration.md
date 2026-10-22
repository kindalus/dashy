# Migration from the Vetify application

This release replaces the Nuxt/Vue application with a generic Nitro 3 + Vite + Bun + Solid 2 application. It removes the Vetify pages, live Vendus integration, domain-specific queries and roles, credit recommendations, data-quality pages and SQL console.

The original source was archived before edits at `/tmp/dashy-migration-backup/original-source.tar.gz` in the migration workspace. This temporary archive is a recovery aid, not part of a deployment.

## Port a project

1. Declare source tables in `project.sources` with adapter type and file path. There is no global `/lake` convention.
2. Move each SQL builder to `project.queries`. Builders return `{ text, values }` instead of `{ sql, bindings }`.
3. Move parameter definitions to `project.params`. Use `default`, `required`, and a discriminating `type`. Replace domain-specific dimension selectors with project-owned parameter options or extend the renderer.
4. Reference a query from each dataset and declare its table columns. Define chart axes and series if needed.
5. Reference a query and scalar column from each metric. Text metrics use the same contract as numeric metrics.
6. Replace dashboard `kind`, `colSpan` and `rowSpan` with `type` and `width`. Use plain `defaults` rather than named default functions.
7. Provide the project's authentication hook and roles. The old home-directory auth files are not read or modified.
8. Export the project from `dashy.config.ts` and run the tests, typecheck and build.

There are no specialized page renderers. Every dashboard uses the same route and component implementation. Old API payloads, dataset normalization and auth routes are not retained; API consumers must migrate to the contracts in the README.

## UI behavior

The new renderer includes an accessible dashboard selector on mobile, wrapping filters, a responsive 12-column grid, independently scrolling tables, pagination, labelled controls, visible keyboard focus, chart/table toggles, reduced-motion handling, loading feedback and per-block errors. Source data is rendered as text, including chart tooltips.

## Verification in the migration environment

The installed stack passes TypeScript checking and the production build. Engine and HTTP tests exercise real CSV, JSON, SQLite, Excel, DuckDB and Parquet files, parameter validation, access control, cross-format joins and shared queries.

`bun run check:build` copies the production output outside the repository and verifies SSR, hydration payloads, client assets, filtering, all six sample formats and route errors. This also verifies that Nitro copies the native DuckDB and Excel runtime dependencies into the deployment output.

Browser verification completed on 2026-10-22 with Chrome against both Vite development and the Bun production server:

- SSR hydrates without warnings; line and bar charts render as SVG and table toggles respond.
- Selecting North updates revenue from €6,420 to €3,160, updates charts and tables, and preserves a chosen table view across filtering and refresh.
- A period with no orders shows zero aggregate metrics and empty datasets; Reset restores the defaults.
- The six source tables render consistently. Pagination shows eight rows followed by four; refresh returns to page one.
- Mobile dashboard navigation works. At 390 px and 320 px, the document has no horizontal overflow; wide tables scroll within their cards. At 320 px, date inputs stack so their values remain readable.
- Offline refresh retains existing data and shows a retry action; retry succeeds after restoring connectivity.
- The final development console has no errors, warnings or form issues. Production interactions were also checked without JavaScript errors or hydration warnings; an offline network error was intentionally induced for the retry test.

The browser checks are manual DevTools verification, not part of `bun test`. Repeat them when changing the renderer or upgrading Solid/Nitro. Both frameworks remain pinned to prerelease versions. The build reports a size advisory for the lazily loaded chart chunk (about 544 kB before gzip); the initial client entry is about 68 kB before gzip.

## Deferred dashboard data

The initial HTML contains a `DashboardShell` with layout, authorized block labels,
parsed filters and a request plan. It contains no metric values or dataset rows.
The browser starts one request per underlying query through
`GET /api/dashboard-data/:dashboard/:request`, always carrying the applied
parameters. All blocks sharing that query reuse its response; unrelated results
render independently. The aggregate dashboard API remains available for clients
that need a complete dashboard response.

Spinners, errors and retries are local to the affected blocks. A retry only
repeats the failed data request. Filters remain usable while loading; a new
selection aborts obsolete requests and ignores late responses. Refreshes keep
previous content mounted beneath the loading indicator. No result cache is
shared between filter selections or users.

Loader tests cover independent completion, one request for shared blocks, query
parameters, retry deduplication, cancellation and late responses. Engine/HTTP
tests cover grouped execution, cleared/default filters and authorization.

Production browser checks confirmed that the four Maven metrics appear after
one shared request while the two chart requests are still pending. An induced
failure in the monthly chart left the other blocks usable; retry sent only the
monthly request and kept the other chart's instance. Applying Online and then
Store while requests were pending cancelled the Online requests and displayed
only Store results. Every data request included the selected period, country,
category and channel.

## Opt-in samples

Dashy now starts with empty registries in `dashy.config.ts`. The old synthetic
project and data moved from `examples/` to `samples/source-examples/`. Use
`bun run dev --with-sample source-examples` to open it. The full retail sample is
`maven-analytics`. Neither sample is active by default.

The CLI loads configuration at runtime. Relative data directories resolve against
the config file. `DASHY_DATA_DIR` was specific to the old example and is no longer
used; edit the selected project's `dataDir` instead. Deployments can start from
`.output` with `bun dashy.mjs start --with-sample <name>`.
