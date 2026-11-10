# Dashy

Dashy renders dashboards defined in TypeScript. The engine reads SQLite, CSV, JSON, Excel `.xlsx`, DuckDB and Parquet sources, executes registered SQL queries, and presents metrics, charts and tables. Project definitions live outside the engine.

Pages initially contain the dashboard layout, labels and filters, without running
data queries. After hydration, the browser requests each independent dataset in
parallel, including the applied parameters. Metrics and charts sharing an
underlying query share one request, even when their presentation definitions
differ. Each block displays its result as soon as that request completes, with a
theme-colored spinner only while its own data is pending. Refreshes retain the
previous data beneath a loading indicator; failed requests offer a local retry
without reloading successful panels. New filters cancel obsolete requests and
discard their late responses. JavaScript is required to load the data. Authentication, dashboard
permissions and URL parameters are checked before sending the initial page and
again when requesting its data.

The application uses **Nitro 3, Vite 8, Bun and Solid 2**. Solid and Nitro are pinned to prerelease versions; the Solid Vite plugin is the Solid 2 package `@solidjs/vite-plugin`.

## Run

```sh
bun install
bun run dev
```

Open `http://localhost:3000`. Dashy starts empty, with no sources, queries,
metrics, datasets or dashboards. Define your own project in `dashy.config.ts`,
or select one of the included samples:

```sh
bun run dashy samples
bun run dev --with-sample maven-analytics
bun run dev --with-sample source-examples
```

`maven-analytics` includes the full Global Electronics Retailer CSV dataset and
five dashboards and two custom pages: Product explorer and Market explorer.
`source-examples` contains 12 synthetic orders in six formats.
Both work offline. Selecting a sample reads it directly from `samples/<name>`;
it never overwrites your project. An unknown name exits with an error and lists
the available samples. See [the sample convention](samples/README.md).

```sh
bun test
bun run typecheck
bun run build
bun run check:build
bun run check:container                        # podman ou docker
bun run start                                  # your project, empty by default
bun run dashy build --with-sample maven-analytics
bun scripts/check-build.ts --maven
bun run start --with-sample maven-analytics     # includes the two custom pages
```

For the short command, register the local executable once with `bun link` and
ensure Bun's bin directory is on PATH:

```sh
dashy samples
dashy start --with-sample maven-analytics
dashy dev --with-sample source-examples --port 3001
```

Run these commands from the project root, or invoke the CLI by its absolute path with `DASHY_PROJECT_DIR` for an external implementation. Production requires a build; sample selection
happens at runtime for artifacts. Samples with custom components, including Maven,
must be selected during build so their pages are compiled. Config edits
require restarting the server. `--port` chooses the listening port.

Formatting uses `pt` by default, including the samples. Set `locale` in
`dashy.config.ts` for a project default, or override it for one run:

```sh
bun run dev --locale en
bun run start --with-sample maven-analytics --locale pt-AO
# From a deployed .output directory:
bun dashy.mjs start --locale en
```

Precedence is `--locale`, `DASHY_LOCALE`, the project's `locale`, then `pt`. The option
formats numbers, currencies and dates; it does not change currencies. Invalid
language tags fail before the server starts.

Dashy's own interface (buttons, menus, filters, states, exports and error pages) is
in English or Portuguese. The project's `language` (`"en"` or `"pt"`) sets the
default, otherwise a Portuguese `locale` gives Portuguese and any other locale
English. Viewers can switch it in the sidebar, like the theme; the choice is saved
in the `dashy_language` cookie and applies from the first response. Numbers and
dates follow the chosen language, keeping the project locale when it is in that
language (for example `pt-AO`). `languages: ["pt"]` limits the choices and
`languages: false` hides the selector. Labels your project defines (dashboards,
datasets, parameters) are shown as written.

Deploy the `.output` directory with Bun installed. From that directory:

```sh
bun dashy.mjs start
# Requires a build selected with --with-sample maven-analytics:
bun dashy.mjs start --with-sample maven-analytics
```

The output includes the CLI, page manifest, bundled selected configuration and
artifacts, compiled custom pages, samples and registered relative source files.
Absolute sources stay external. Runtime configurations kept outside the build
need their own installed dependencies. Native DuckDB bindings must match the
deployment OS and architecture. Dashy pins
DuckDB 2.0.0 LTS through `@duckdb/node-api@2.0.0-r.1`. New `.duckdb` files
created with 2.0 cannot be opened by older DuckDB versions; check any other
process that shares those files before upgrading it.
`check:build` runs this deployment in isolation and checks the empty workspace,
Source Examples, runtime discovery, SSR, assets, filters and missing-sample errors.
After building Maven, `bun scripts/check-build.ts --maven` checks its dashboards,
custom pages, initial CSS and datasets in an isolated deployment.

## External implementations and custom pages

Keep your implementation outside the Dashy installation:

```sh
export DASHY_PROJECT_DIR=/srv/my-application
bun /opt/dashy/bin/dashy.ts dev
bun /opt/dashy/bin/dashy.ts build
bun /opt/dashy/bin/dashy.ts start
```

The implementation contains `dashy.config.ts`, `artifacts/index.ts`, and
`extensions/index.ts` with custom Solid pages under `extensions/`.
`DASHY_CONFIG`, `DASHY_ARTIFACTS_DIR`, `DASHY_EXTENSIONS_DIR` and `DASHY_DATA_DIR`
override individual paths. `DASHY_THEME` and `DASHY_LOCALE` override presentation.
Pages share the workspace, icons, navigation groups and authentication, and appear
at `/pages/:id`. Page components and styles require a build; external server
configuration and artifacts can change with a restart. Pages import data helpers,
`formatValue`, `Spinner` and the dashboards' themed `Select` from `dashy/ui`.

See [the complete setup and page contract](llms.txt#implementações-externas-e-variáveis-de-ambiente)
and the runnable [external application example](examples/external-application/).
`bun run check:extensions` tests an independent implementation and a portable build;
run your intended build again afterward, since the check writes `.output/`.

## Define your project

For an agent-oriented implementation guide with a complete runnable example, see [llms.txt](llms.txt).

Edit [`dashy.config.ts`](dashy.config.ts). Complete runnable projects live in [`samples/`](samples/README.md). Relative `dataDir` values resolve against the selected configuration file.

The Dashy symbol and product name are fixed. Set `name` to your application name,
which appears underneath. Each dashboard can set a Lucide `icon` and a `group`
label. See [branding, icon names and navigation groups](docs/contracts.md#branding-and-dashboard-navigation).

| Definition | Responsibility                                                   |
| ---------- | ---------------------------------------------------------------- |
| Source     | Where a table comes from and which adapter reads it (globs and hive partitions for Parquet) |
| Parameter  | A typed input, its validation, filter control, relative default and optional options query |
| Query      | SQL, bound values, declared sources and accepted parameters      |
| Dataset    | A query result with column labels, formats, parameter annotations and an optional chart |
| Metric     | One scalar column from a query returning at most one row         |
| Dashboard  | Blocks, layout, filters (applied to every block), defaults, required values and drillthrough |

Sources feed queries. Datasets and metrics reference those queries. Dashboards reference datasets and metrics. A dataset is a tabular result, not a persisted table. Queries can join multiple sources, including different formats.

The browser receives presentation definitions and query results. It does not receive source paths, query builders or authentication configuration. Only registered queries can execute through HTTP; there is no arbitrary SQL console.

Clicking a value whose column declares a parameter cross-filters the dashboard or opens a drillthrough destination. Dashboards declare the parameter they detail, so datasets never reference pages. Datasets can also declare drill-down levels (Category → Brand → Product, Year → Quarter → Month) that a click walks down inside the block, with a breadcrumb back; see [drill-down](docs/contracts.md#drill-down). Thirteen chart types are available: cartesian lines, bars, areas, stacks, dual axes (use sparingly) and scatter, plus pie, funnel, treemap, sunburst, heatmap, gauge, radar, sankey and boxplot.

Tables sort by any column and can add totals, nested subtotals and a Top N selector with an optional "Other" row, all driven by per-column aggregates. See [sorting, totals, subtotals and Top N](docs/contracts.md#sorting-totals-subtotals-and-top-n). Every dataset block downloads as CSV or Excel, exactly as shown; see [export](docs/contracts.md#export). Cartesian series can add reference lines, a linear trend and a client-side forecast; see [reference lines, trends and forecasts](docs/contracts.md#reference-lines-trends-and-forecasts). Metric cards can compare with another period, show progress towards a target and draw a sparkline; see [comparison, target and sparkline](docs/contracts.md#comparison-target-and-sparkline). The query row can also set a metric's tone, add a note and give a fallback text for missing values; see [tone, note and fallback](docs/contracts.md#tone-note-and-fallback). Charts save as PNG or SVG, and every dashboard prints or saves as PDF; see [images and printing](docs/contracts.md#images-and-printing).

See [contracts and examples](docs/contracts.md), [source adapters](docs/sources.md), [authentication](docs/auth.md), [embedding](docs/embedding.md), [container deployment](docs/deployment.md), and [migration notes](docs/migration.md).

## Layout

- `core/`: framework-independent contracts, validation, source adapters, execution and HTTP handlers.
- `src/`: the Solid dashboard renderer, filters, charts, tables and SSR entries.
- `samples/`: independent opt-in projects and their data.
- `bin/dashy.ts`: startup and sample selection.
- `core/runtime.ts`: filesystem discovery and runtime configuration loading.
- `tests/`: integration tests against real files and HTTP requests.
- `vite.config.ts`: Solid 2 compilation, Nitro integration and the Bun production preset.

## Themes

Choose `zafir` (default), `excel`, `chromeos`, `chatgpt`, `claude-code`, `macos`, `power-bi`, `microstrategy` or `cognos` at startup, or a theme your project adds ([project themes](docs/themes.md#project-themes)):

```sh
bun run dev --theme chromeos
bun run dev --with-sample maven-analytics --theme claude-code
bun run start --theme macos
```

`--theme` overrides the project's theme and uses the selected theme's default corners for that run. It does not edit configuration files. The packaged CLI also accepts it: `bun dashy.mjs start --theme chatgpt`.

To persist your choice or customize the corners, use the selected project's configuration:

```ts
theme: {
  name: "excel",
  corners: { inputs: "rounded-sm", buttons: "rounded", panels: "rounded-md" },
},
```

Corners can also use one shared style: `corners: "none"`. Supported styles are `none`, `rounded` (pill buttons), `rounded-sm`, `rounded-md` and `rounded-lg`. Each theme supplies defaults when corners are omitted. Restart after configuration edits; when using `--with-sample`, edit that sample's config.

Viewers can switch themes from the selector at the bottom of the sidebar, without a restart; the choice is kept in a cookie and applied during server rendering. `theme.selectable` limits the choices (`["excel", "power-bi"]`) or hides the selector (`false`). See [viewer selection](docs/themes.md#viewer-selection).

All themes coordinate charts, controls, panels and navigation through CSS tokens in `src/themes/`, and every chart palette passes lightness, saturation, contrast and colour-vision checks. Every theme adds a signature, such as Excel's formula bar and sheet tabs, Power BI's filters pane or Claude Code's command line; see [signatures](docs/themes.md#signatures). Filters appear as chips that open their control in a popover. Chart colors follow series order; `chart.series[].color` overrides a series explicitly. See [theme configuration and defaults](docs/themes.md) and [the chart palette](docs/contracts.md#chart-palette).

Icons use Lucide 1.61.0 with named imports. Its license notices ship at `public/licenses/lucide.txt`.

## Access control

The included samples are public. A private project provides `authenticate(request)` in its configuration. Return `{ roles: [...] }` for an authenticated request, `{ redirect }` to send a page request to a login page, or `null` to deny access. The hook protects SSR, the catalog and all API endpoints. Queries, metrics, datasets, dashboards and custom pages can each declare roles; access requires a match at every level used.

The optional `dashy/auth` module supplies the hook and `/auth/*` routes with signed session cookies, OpenID Connect (authorization code with PKCE) and API keys (`X-API-Key`, `Authorization: Bearer` or `?api_key=`, which becomes a session on pages). Roles come from a project function, for example by e-mail. See [authentication](docs/auth.md).

## Embedding

Other applications can show Dashy charts and dashboards with signed tokens that
their server mints with an API key (`POST /api/embed`): a static SVG of a dataset
chart (`/api/datasets/:name?_format=svg`, drawn on the server in the project's
theme), and an interactive iframe of a dashboard or one dataset
(`/embed/dashboards/:name`, `/embed/datasets/:name`) where viewers use only the
mouse: tooltips, cross-filter and drill-down. Parameters fixed in a token never
change; fix every parameter that must not change. Enable it with
`embed: { secret, origins, maxTtlSeconds }`. See [embedding](docs/embedding.md);
`bun scripts/embed-host.ts` runs a test host page against the Maven sample.

## Limits, cache and containers

All requests share one DuckDB instance per process with configurable memory, threads, concurrency, queue and timeouts (`limits`). Excess requests queue and then receive 503 with `Retry-After`. An opt-in result cache (`cache: { ttlSeconds }`) shares identical query executions; `?refresh=true` bypasses it. `timezone` sets "today" for relative defaults and DuckDB's `current_date`.

`Containerfile` builds a Bun 1.4 base image with the engine; `examples/external-application/Containerfile` builds a project image from it. `/healthz` is a public liveness probe. `bun run check:container` verifies both. See [container deployment](docs/deployment.md).

Project files and SQL builders are trusted server code. HTTP parameters are untrusted, validated and bound separately from SQL. Do not interpolate user values into SQL or let requests choose file paths. Source databases are opened read-only. See [source limits](docs/sources.md) before loading large files.

## API

Built-in data endpoints are `GET` (except `POST /api/embed`) and share the project's authentication hook.
Custom routes under `/api/custom/` can declare additional methods:

```text
/api/catalog
/api/dashboards/:name
/api/dashboard-shell/:name
/api/dashboard-data/:dashboard/:request
/api/dashboard-export/:dashboard/:block  ?_format=csv|xlsx &_sort= &_top=
/api/metrics/:name
/api/datasets/:name             ?_format=json|svg &_width= &_height= &_theme= &_lang=
/api/queries/:name
/api/params/:name/options      ?_q= &_value= &_limit=
/api/embed/shell                 embed token in X-Dashy-Embed
/api/embed/data/:request
/healthz
POST /api/embed                  mint an embed token (API keys only)
```

Ranges use `?period.from=2026-01-01&period.until=2026-06-30`. Arrays use repeated keys. Unknown parameters are rejected; `api_key`, `token`, `refresh`, `_from`, `_xf`, `_dd`, `_format`, `_sort`, `_top`, `_width`, `_height`, `_theme` and `_lang` are reserved for the engine. `refresh=true` bypasses the result cache. Cross-filter origins travel as `_xf=<block>:<param>` and drill-down paths as `_dd=<block>:<value>`. Responses are not cached by shared HTTP caches. Within one dashboard request, a query used by several blocks runs once.

The initial page includes request IDs and their consuming block IDs. A
`dashboard-data` request returns only that group's blocks and a timestamp; it
validates the dashboard parameters and all block/query permissions. The browser
deduplicates within the current dashboard and filter selection, without sharing
results between users or reusing stale results after filters change.

## Framework references

- [Nitro's Vite SSR example for Solid](https://nitro.build/examples/vite-ssr-solid). The example uses Solid 1 APIs; this project uses the Solid 2 equivalents.
- [Solid 2 announcement](https://www.solidjs.com/blog/solid-2-0-rc-the-big-reveal).
- [Solid 2 migration guide](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md).
- [Solid 2 Vite plugin](https://github.com/solidjs/solid-vite-plugin/tree/next).
- [Bun SQLite](https://bun.sh/docs/runtime/sqlite), [DuckDB Node API](https://duckdb.org/docs/stable/clients/node_neo/overview), [ExcelJS](https://github.com/exceljs/exceljs#reading-xlsx).

## Custom API routes

Register server handlers in `extensions/api/index.ts` using `defineApiRoutes` from
`dashy`, or in the config's `api` registry. The directory follows
`DASHY_EXTENSIONS_DIR` and may contain API routes without any custom pages.
Routes run under `/api/custom/`, inherit application authentication, support roles
and receive dataset/query/metric helpers bound to the requesting principal.

GET, POST, PUT, PATCH and DELETE handlers return standard `Response` objects.
HEAD and OPTIONS are automatic. Write requests require `X-Dashy-Request: 1` and
same-origin browser requests. Request bodies default to a 1 MiB limit.
Server handlers are excluded from client assets and protected against direct Vite
file access. Restart after changing external handlers; rebuild distributed packages.

Maven includes `/api/custom/markets`, `/api/custom/markets/:country/orders` and
POST `/api/custom/calculate-margin`. Market explorer uses the markets endpoint.
The external Customer 360 example uses `/api/custom/customers/:id/orders`.
See [llms.txt](llms.txt) for definitions, validation, security and deployment details.
