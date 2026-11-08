# Contracts and examples

The public interfaces are in `core/types.ts`. Import `defineProject` from `core/project.ts` to validate references and layouts at startup. All names are stable identifiers containing letters, numbers, underscores or hyphens, starting with a letter.

## Parameters

Parameters are registered once and referenced by name. A dashboard's `params` controls its filter bar; a query's `params` controls which inputs its builder receives.

```ts
params: {
  period: {
    label: 'Period', type: 'range', valueType: 'date',
    default: { relative: 'ytd' }
  },
  region: {
    label: 'Region', type: 'select',
    options: [{ label: 'North', value: 'North' }, { label: 'South', value: 'South' }]
  },
  customer: {
    label: 'Customer', type: 'string', placeholder: 'Search customers',
    options: { query: 'customer_options', value: 'id', label: 'name', search: true }
  },
  brands: {
    label: 'Brands', type: 'array',
    options: { query: 'brand_options', value: 'brand' }
  },
  minimum: { label: 'Minimum amount', type: 'number', min: 0, default: 0 },
  includeReturns: { label: 'Include returns', type: 'boolean', default: false }
}
```

Supported types are `string`, `number`, `boolean`, `date`, `select`, `array` and `range`. Number constraints are `integer`, `min` and `max`. Arrays use `valueType` and accept at most 250 items. Ranges use `valueType` and require both endpoints. Dates must be real calendar dates in `YYYY-MM-DD` format. Static `options` are enforced for `select` and `array`.

Precedence is explicit request value, dashboard default, parameter default. Empty optional inputs clear a filter. Required inputs cannot be cleared. Defaults go through the same validation as supplied values.

### Relative defaults

Defaults may be relative to today in the project's `timezone` (default `UTC`). They are evaluated on every request, never once at startup, so a long-running server never serves a stale "year to date".

| Default | Value |
| --- | --- |
| `{ relative: 'ytd' }`, `'mtd'` | 1 January / 1st of the month until today |
| `{ relative: 'last-closed-month' }`, `'last-closed-year'` | the previous complete month or year |
| `{ relative: 'last-days', days: 30 }` | the last 30 days including today |
| `{ relative: 'next-days', days: 90 }` | today until 90 days ahead |
| `{ relative: 'last-months', months: 12 }` | the same day 12 months ago until today |
| `{ from: RelativeDate, until: RelativeDate }` | any combination of anchors |
| `{ relative: 'today' \| 'yesterday' \| 'start-of-month' \| 'start-of-year' \| 'start-of-last-month' \| 'end-of-last-month' \| 'start-of-last-year' \| 'end-of-last-year', years?, months?, days?, as? }` | one date |

Ranges require a date range parameter. Single relative dates accept integer offsets applied as years, months, then days; month offsets clamp to the last day of the target month. `as: 'month'` produces `YYYY-MM` for string parameters, and `as: 'year'` or `as: 'month-number'` produce numbers for number parameters. Dashboard `defaults` accept the same values.

### Options from a query

`options: { query, value, label?, search?, limit? }` reads options from a registered query, which must return the `value` column (and `label`, if given). The options query may accept other parameters: the endpoint receives the current filters and applies only those the options query accepts, so brand options can follow the selected category. An options query cannot depend on its own parameter.

```text
GET /api/params/:name/options?_q=talatona&_limit=20&category=Food
GET /api/params/:name/options?_value=C1&_value=C2      # labels for selected values
→ { "options": [{ "value": "C1", "label": "Clínica Talatona" }], "truncated": false }
```

`search: true` filters on the server (case-insensitive on label and value; `%` and `_` are literal). `limit` defaults to 50 and cannot exceed 500. The options query's roles apply and results go through the cache.

Submitted values are validated by type and always bound to SQL. Set `strict: true` to also confirm that each value exists among the options before any data query runs; invalid values receive 400.

### Filter controls

Controls follow the definition; there is no per-block configuration.

| Definition | Control |
| --- | --- |
| `select` with static options | select |
| `boolean` | All / Yes / No |
| `array` with static or query options | multiselect with a filter box |
| `string`, `number`, `select` or `array` with `search: true` | autocomplete (chips for arrays) |
| `range` of dates | date inputs with presets: year/month to date, last closed month/year, last 30 days, last 12 months |
| `array` without options | comma-separated text |

### Reserved query keys

`api_key`, `refresh`, `_from` and `_xf` belong to the engine and are never validated as parameters; they cannot be used as parameter names. `refresh=true` bypasses the result cache, `_from` holds the drillthrough origin and `_xf` the cross-filter origins.

```ts
// HTTP: ?period.from=2026-01-01&period.until=2026-06-30&region=North
// The query builder receives:
params = {
  period: { from: "2026-01-01", until: "2026-06-30" },
  region: "North",
};
```

## Sources and queries

A query declares sources and accepted parameters. `source(name)` returns a quoted table identifier and rejects undeclared sources. The source adapter mounts the table before the query runs. Parquet sources accept globs and hive partition types; see [source adapters](sources.md).

```ts
sources: {
  orders: { type: 'csv', path: 'orders.csv' },
  sales: { type: 'parquet', path: 'gold/fact_sales/**/*.parquet', hive: { types: { year: 'INTEGER', month: 'INTEGER' } } }
},
queries: {
  revenueByMonth: {
    label: 'Revenue by month',
    sources: ['orders'],
    params: ['period', 'region'],
    maxRows: 120,
    build: ({ source, params, sql }) => {
      const where = sql.where(
        sql.range('date', params.period as { from: string; until: string } | undefined),
        sql.eq('region', params.region as string | undefined)
      )
      return {
        text: `SELECT strftime(CAST(date AS DATE), '%Y-%m') AS month,
                      SUM(revenue) AS revenue
               FROM ${source('orders')} ${where.text}
               GROUP BY 1 ORDER BY 1`,
        values: where.values
      }
    }
  },
  totalRevenue: {
    label: 'Total revenue', sources: ['orders'],
    cache: { ttlSeconds: 60 },
    build: ({ source }) => ({
      text: `SELECT SUM(revenue) AS value FROM ${source('orders')}`,
      values: []
    })
  }
}
```

The internal `sql` helper is implemented in `core/sql.ts`. `eq`, `in` and `range` build bound predicates. `where` combines non-empty predicates with `AND`. `fragment` accepts trusted SQL text and a values array. These helpers never infer business rules or filter column mappings.

The response is `{ columns, rows, truncated, durationMs, cached? }`. Numeric values exceeding JSON's exact representation may arrive as strings, as returned by DuckDB. The UI formats numeric strings without altering the API value. An empty dataset retains its column metadata.

A query's `cache` overrides the project cache: `false` disables it, `{ ttlSeconds }` changes the lifetime. See [limits and cache](#limits-and-cache).

## Datasets

A dataset describes which columns to present. The query remains separately reusable.

```ts
datasets: {
  sales: {
    label: 'Sales over time',
    query: 'revenueByMonth',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'revenue', label: 'Revenue', format: { style: 'currency', currency: 'EUR' } }
    ],
    chart: {
      type: 'cartesian', x: 'month',
      series: [
        { key: 'online', label: 'Online', as: 'area', stack: 'revenue' },
        { key: 'store', label: 'Store', as: 'area', stack: 'revenue' },
        { key: 'orders', label: 'Orders', as: 'line', axis: 'right' }
      ]
    }
  }
}
```

Every chart can switch to a table. Omit `chart` for a table-only dataset. Column and series formats accept `number`, `currency`, `percent`, `text` and `date`. Percent formatting expects a fraction, for example `0.25` for 25%.

### Chart types

| `type` | Columns | Use |
| --- | --- | --- |
| `cartesian` | `x`, `series[]` with `as` (`line`, `bar`, `area`, `scatter`), `axis` (`left`/`right`), `stack`, `smooth`; `xType` (`category`, `time`, `value`); `orientation` (`vertical`/`horizontal`) | lines, bars, areas, stacks, combinations, dual axes, scatter |
| `line`, `bar`, `area` | as `cartesian`; shorthand for one series kind | existing projects keep working |
| `pie` | `category`, `value`, `donut?` | shares |
| `funnel` | `category`, `value` | ordered stages |
| `treemap`, `sunburst` | `path: [columns]`, `value` | hierarchies |
| `heatmap` | `x`, `y`, `value` | two categorical dimensions |
| `gauge` | `value`, `min`, `max`, `bands: [{ until, tone }]` | one value against bands (`danger`, `warning`, `success`, `neutral`) |
| `radar` | `category`, `series[]`, `max?` | profiles |
| `sankey` | `source`, `target`, `value` | flows |
| `boxplot` | `category`, `value` (raw values; quartiles computed in the browser) | distributions |

Validation checks every referenced column at startup. Horizontal charts support only the left axis. Chart modules load on demand, so a dashboard downloads only the types it uses. Series use the theme's palette by default; set a series `color` only when it needs an explicit semantic color.

When the series legend does not fit, its arrows page through the remaining labels on one line, keeping the legend clear of the plot on narrow screens.

### Column parameters

A column can declare which parameter its values belong to. This is information about the data, never a navigation target:

```ts
columns: [
  { key: 'category', label: 'Category', param: 'category' },
  // Show the name, pass the ID: `from` may be any result column.
  { key: 'customer_name', label: 'Customer', param: { name: 'customer', from: 'customer_id' } },
]
```

Dashboards turn these annotations into [cross-filters and drillthrough](#interaction-cross-filter-and-drillthrough). The catalog exposes them, so API clients can chain datasets that accept the same parameter. Range parameters cannot be column parameters.

## Metrics

A metric selects one scalar column from a query. It can be numeric, text, a date or a boolean. Multiple metrics can reference separate columns from the same query, as demonstrated by `summary` in the sample.

```ts
metrics: {
  revenue: {
    label: 'Revenue', query: 'totalRevenue', column: 'value',
    format: { style: 'currency', currency: 'EUR', decimals: 0 }
  }
}
```

A missing column or multiple result rows is an error. No rows or a SQL `NULL` gives a null metric, displayed as an em dash. Use `COALESCE` in SQL when zero is the intended business meaning.

## Dashboards

```ts
dashboards: {
  overview: {
    label: 'Overview',
    description: 'Sales in the selected period.',
    params: ['period', 'region'],
    defaults: { period: { relative: 'last-months', months: 12 } },
    // The catalogue size describes all products; it intentionally ignores filters.
    unfiltered: { catalogue: ['period', 'region'] },
    blocks: [
      { id: 'revenue', type: 'metric', metric: 'revenue', width: 3 },
      { id: 'catalogue', type: 'metric', metric: 'catalogue', width: 3 },
      { id: 'sales-chart', type: 'dataset', dataset: 'sales', width: 6 },
      { id: 'sales-table', type: 'dataset', dataset: 'sales', view: 'table', width: 12 }
    ]
  }
}
```

**Filters belong to the dashboard.** Every block's query must accept every dashboard parameter. Startup fails otherwise, naming the block, query and parameter, so a filter never silently skips a block. A block that intentionally ignores a filter is declared in `unfiltered`; validation confirms the query really does not accept it, and the block shows "Not filtered by …".

`required: ['customer']` makes a dashboard wait for those values: it shows only the filter bar and a prompt, and runs no queries until they are set.

The layout uses 12 columns on wide screens and collapses on smaller screens. Block IDs must be unique within a dashboard. The URL is `/dashboards/overview`; no page component is needed. A block that fails displays an error without hiding successful blocks.

## Interaction: cross-filter and drillthrough

Both use the same column annotations. Datasets never name a dashboard.

**Cross-filter.** Clicking a value whose column parameter is one of the dashboard's filters sets that filter, exactly as if it had been chosen in the filter bar. The filter bar and the URL show it; reloading or sharing the link reproduces the screen. Every block reloads filtered, except the block that was clicked, which keeps all its values and highlights the selection. Clicking the selected value again clears the filter; clicking another replaces it. The URL records the origin as `_xf=<block>:<param>`.

**Drillthrough.** A dashboard declares the parameter it details:

```ts
customer360: {
  label: 'Customer 360',
  params: ['period', 'customer'],
  required: ['customer'],
  drillthrough: { param: 'customer', keepFilters: true },
  blocks: [/* … */]
}
```

Any value of `customer`, in any table or chart of another dashboard, can then open Customer 360. The link carries the value (from the column's `from`), the origin's filters that the destination accepts when `keepFilters` is not `false`, and `_from` for a "← origin" link. Several destinations for one parameter are offered in a menu. Destinations the user cannot read are never offered.

`drillthroughTargets` changes destinations for one dashboard, without touching datasets:

```ts
operations: {
  params: ['period', 'category'],
  drillthroughTargets: { sku: 'stock-explorer', customer: false },
  blocks: [/* … */]
}
```

**One click.** When a value has one action, the click performs it. With two or more (for example, filter this dashboard and open Customer 360), a small menu opens next to the value. It works the same with a mouse, touch or keyboard: table values are buttons, the menu takes focus and supports arrow keys and Escape.

The page shell is available as `GET /api/dashboard-shell/:name` (same parameters and `_xf`), returning `{ params, requests, missing, crossFilters, … }` without running queries.

## Limits and cache

All queries in a process share one DuckDB instance with a process-wide memory limit. Each request uses its own connection from a bounded pool; temporary views are connection-local and dropped when the request ends.

```ts
limits: {
  memory: '512MB',          // whole process, default 1GB
  threads: 2,               // default 2
  maxConcurrentQueries: 2,  // sessions executing at once, default 4
  maxQueuedQueries: 20,     // waiting sessions before 503, default 32
  queueTimeoutMs: 15_000,   // default 15 s
  queryTimeoutMs: 30_000,   // default 30 s
  tempDirectory: '/tmp/dashy-duckdb'
},
cache: { ttlSeconds: 600, maxBytes: '64MB' },
timezone: 'Africa/Luanda'
```

When the queue is full or the wait exceeds `queueTimeoutMs`, requests receive `503` with `Retry-After`. Configuration is locked after startup: builders cannot raise limits or change the timezone. The timezone also sets DuckDB's `current_date`.

The cache is off unless `cache` is set. It keys results by query name, bound SQL and row limit; roles are checked before every lookup, and the principal is not part of the key because the engine has no row-level security. Concurrent identical requests share one execution. Errors are never cached. `?refresh=true` bypasses and repopulates entries.

## Authentication

`authenticate(request)` returns a principal, `{ principal, headers }` to add response headers such as a renewed cookie, `{ redirect, headers? }` to send an unauthenticated page request to a login page, or `null` (401). Redirects apply only to pages; data requests receive 401 with `WWW-Authenticate`. `authRoutes(request)` handles `/auth/*` before authentication. The optional `dashy/auth` module provides both with sessions, OpenID Connect and API keys: see [authentication](auth.md).

The fragments above illustrate individual contracts. `samples/source-examples/dashy.config.ts` is the complete executable example; `samples/maven-analytics` demonstrates query options, cross-filters, drillthrough and every chart type.

## Branding and dashboard navigation

The renderer always shows the Dashy symbol and the name **Dashy**. The project's
`name` is the application name displayed underneath, for example `Analytics Vetify`.
This branding also appears on mobile; it is not replaced by a sample's name.

Dashboards can declare a Lucide icon name and a navigation group:

```ts
name: "Analytics Vetify",
dashboards: {
  executive: {
    label: "Executivo",
    icon: "panels-top-left",
    group: "Dashboards",
    blocks: [],
  },
  client360: {
    label: "Cliente 360",
    icon: "user-search",
    group: "Visualizações",
    blocks: [],
  },
},
```

Groups appear in order of first occurrence in the dashboard registry. Dashboards
within each group retain their declaration order. Omitted `group` uses
`Dashboards`; omitted `icon` uses `layout-dashboard`. The mobile selector uses the
same groups as option groups. Groups are derived from the authorized catalog, so
an inaccessible dashboard does not expose a section label. Groups do not grant
access or change routes; `roles` still controls access per dashboard.

Dashy provides a fixed selection from [Lucide](https://lucide.dev/icons), pinned
to the `lucide` package version in `package.json`. Names use kebab-case:

```text
layout-dashboard      panels-top-left        chart-no-axes-combined
chart-line            chart-column           chart-pie
circle-dollar-sign    wallet                 shield-check
users                 user-search            contact
package               boxes                  shapes
paw-print             shopping-cart          store
globe                 database               table
file-chart-column     activity               settings
```

The typed name list is in `core/icons.ts`, with named imports in `src/icons.tsx`.
Unknown names and blank group labels fail project validation. To extend the
selection, add the Lucide name to both registries; TypeScript checks completeness.
Only those icons enter the client bundle. Project configuration cannot supply SVG
markup or external icon URLs.

## Chart palette

The selected theme assigns colors by series position. Excel uses this palette with moderate saturation:

| Position | Color            | Token       |
| -------- | ---------------- | ----------- |
| 1        | Green `#39865b`  | `--chart-1` |
| 2        | Blue `#4e79b7`   | `--chart-2` |
| 3        | Gold `#b58a35`   | `--chart-3` |
| 4        | Teal `#3d8f9b`   | `--chart-4` |
| 5        | Purple `#8c6bb1` | `--chart-5` |
| 6        | Orange `#c87945` | `--chart-6` |

This is a manually selected categorical palette, not a color calculation based on
the values or series names. After six series it repeats. An explicit
`chart.series[].color` overrides the corresponding slot. To keep a particular
metric the same color in different charts regardless of order, set its `color`
explicitly. The theme does not yet assign colors by semantic key.

See [theme configuration](themes.md) for all five themes and independent input,
button and panel corners. Metric values use a separate theme token, so Excel's
metrics retain the stronger green while chart series use moderately saturated shades.
