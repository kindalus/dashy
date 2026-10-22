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
five dashboards. `source-examples` contains 12 synthetic orders in six formats.
Both work offline. Selecting a sample reads it directly from `samples/<name>`;
it never overwrites your project. An unknown name exits with an error and lists
the available samples. See [the sample convention](samples/README.md).

```sh
bun test
bun run typecheck
bun run build
bun run check:build
bun run start                                  # your project, empty by default
bun run start --with-sample maven-analytics     # the retail sample
```

For the short command, register the local executable once with `bun link` and
ensure Bun's bin directory is on PATH:

```sh
dashy samples
dashy start --with-sample maven-analytics
dashy dev --with-sample source-examples --port 3001
```

Run commands from the project root. Production requires a build; sample selection
happens at runtime, so changing samples does not require rebuilding. Config edits
require restarting the server. `--port` chooses the listening port.

Formatting uses `pt` by default, including the samples. Set `locale` in
`dashy.config.ts` for a project default, or override it for one run:

```sh
bun run dev --locale en
bun run start --with-sample maven-analytics --locale pt-AO
# From a deployed .output directory:
bun dashy.mjs start --locale en
```

Precedence is `--locale`, then the project's `locale`, then `pt`. The option
formats numbers, currencies and dates; it does not translate interface text
or change currencies. Invalid language tags fail before the server starts.

Deploy the `.output` directory with Bun installed. From that directory:

```sh
bun dashy.mjs start
bun dashy.mjs start --with-sample maven-analytics
```

The output includes the CLI, bundled project and sample configurations, and sample
data. For your own project, deploy its source files at the configured `dataDir`
and provide any third-party packages imported by its runtime config. Native
DuckDB bindings must match the deployment OS and architecture.
`check:build` runs this deployment in isolation and checks the empty workspace,
both samples, runtime discovery, SSR, assets, filters and missing-sample errors.

## Define your project

Edit [`dashy.config.ts`](dashy.config.ts). Complete runnable projects live in [`samples/`](samples/README.md). Relative `dataDir` values resolve against the selected configuration file.

The Dashy symbol and product name are fixed. Set `name` to your application name,
which appears underneath. Each dashboard can set a Lucide `icon` and a `group`
label. See [branding, icon names and navigation groups](docs/contracts.md#branding-and-dashboard-navigation).

| Definition | Responsibility                                                   |
| ---------- | ---------------------------------------------------------------- |
| Source     | Where a table comes from and which adapter reads it              |
| Parameter  | A typed input, its validation and filter control                 |
| Query      | SQL, bound values, declared sources and accepted parameters      |
| Dataset    | A query result with column labels, formats and an optional chart |
| Metric     | One scalar column from a query returning at most one row         |
| Dashboard  | A list of blocks, their layout, filters and default values       |

Sources feed queries. Datasets and metrics reference those queries. Dashboards reference datasets and metrics. A dataset is a tabular result, not a persisted table. Queries can join multiple sources, including different formats.

The browser receives presentation definitions and query results. It does not receive source paths, query builders or authentication configuration. Only registered queries can execute through HTTP; there is no arbitrary SQL console.

See [contracts and examples](docs/contracts.md), [source adapters](docs/sources.md), and [migration notes](docs/migration.md).

## Layout

- `core/`: framework-independent contracts, validation, source adapters, execution and HTTP handlers.
- `src/`: the Solid dashboard renderer, filters, charts, tables and SSR entries.
- `samples/`: independent opt-in projects and their data.
- `bin/dashy.ts`: startup and sample selection.
- `core/runtime.ts`: filesystem discovery and runtime configuration loading.
- `tests/`: integration tests against real files and HTTP requests.
- `vite.config.ts`: Solid 2 compilation, Nitro integration and the Bun production preset.

## Themes

Choose `excel` (default), `chromeos`, `chatgpt`, `claude-code` or `macos` at startup:

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

Excel uses green metric values and a chart palette with moderate saturation. All themes coordinate charts, controls, panels and navigation through CSS tokens in `src/themes/`. Chart colors follow series order; `chart.series[].color` overrides a series explicitly. See [theme configuration and defaults](docs/themes.md) and [the chart palette](docs/contracts.md#chart-palette).

Icons use Lucide 1.61.0 with named imports. Its license notices ship at `public/licenses/lucide.txt`.

## Access control

The included samples are public. A private project provides `authenticate(request)` in its configuration. Return `{ roles: [...] }` for an authenticated request or `null` to deny access. Integrate your existing session or identity provider there. The hook protects SSR, the catalog and all API endpoints. Queries, metrics, datasets and dashboards can each declare roles; access requires a match at every level used. No login pages or organization-specific roles are built into the engine.

Project files and SQL builders are trusted server code. HTTP parameters are untrusted, validated and bound separately from SQL. Do not interpolate user values into SQL or let requests choose file paths. Source databases are opened read-only. See [source limits](docs/sources.md) before loading large files.

## API

All endpoints are `GET` and share the project's authentication hook:

```text
/api/catalog
/api/dashboards/:name
/api/dashboard-data/:dashboard/:request
/api/metrics/:name
/api/datasets/:name
/api/queries/:name
```

Ranges use `?period.from=2026-01-01&period.until=2026-06-30`. Arrays use repeated keys. Unknown parameters are rejected. Responses are not cached by shared HTTP caches. Within one dashboard request, a query used by several blocks runs once.

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
