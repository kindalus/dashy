# Contracts and examples

The public interfaces are in `core/types.ts`. Import `defineProject` from `core/project.ts` to validate references and layouts at startup. All names are stable identifiers containing letters, numbers, underscores or hyphens, starting with a letter.

## Parameters

Parameters are registered once and referenced by name. A dashboard's `params` controls its filter bar; a query's `params` controls which inputs its builder receives. The engine selects the relevant dashboard inputs for each query.

```ts
params: {
  period: {
    label: 'Period', type: 'range', valueType: 'date',
    default: { from: '2026-01-01', until: '2026-06-30' }
  },
  region: {
    label: 'Region', type: 'select',
    options: [{ label: 'North', value: 'North' }, { label: 'South', value: 'South' }]
  },
  minimum: { label: 'Minimum amount', type: 'number', min: 0, default: 0 },
  productIds: { label: 'Products', type: 'array', valueType: 'string' },
  customer: { label: 'Customer', type: 'string', required: true },
  includeReturns: { label: 'Include returns', type: 'boolean', default: false }
}
```

Supported types are `string`, `number`, `boolean`, `date`, `select`, `array` and `range`. Number constraints are `integer`, `min` and `max`. Arrays use `valueType` and accept at most 250 items. Ranges use `valueType` and require both endpoints. Dates must be real calendar dates in `YYYY-MM-DD` format.

Precedence is explicit request value, dashboard default, parameter default. Empty optional inputs clear a filter. Required inputs cannot be cleared. Defaults go through the same validation as supplied values. Dashboard defaults are a plain object, not the name of a domain-specific function.

```ts
// HTTP: ?period.from=2026-01-01&period.until=2026-06-30&region=North
// The query builder receives:
params = {
  period: { from: "2026-01-01", until: "2026-06-30" },
  region: "North",
};
```

## Sources and queries

A query declares sources and accepted parameters. `source(name)` returns a quoted table identifier and rejects undeclared sources. The source adapter mounts the table before the query runs.

```ts
sources: {
  orders: { type: 'csv', path: 'orders.csv' }
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
    build: ({ source }) => ({
      text: `SELECT SUM(revenue) AS value FROM ${source('orders')}`,
      values: []
    })
  }
}
```

The internal `sql` helper is implemented in `core/sql.ts`. `eq`, `in` and `range` build bound predicates. `where` combines non-empty predicates with `AND`. `fragment` accepts trusted SQL text and a values array. These helpers never infer business rules or filter column mappings.

The response is `{ columns, rows, truncated, durationMs }`. Numeric values exceeding JSON's exact representation may arrive as strings, as returned by DuckDB. The UI formats numeric strings without altering the API value. An empty dataset retains its column metadata.

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
      type: 'line', x: 'month',
      series: [{ key: 'revenue', label: 'Revenue' }]
    }
  }
}
```

Charts support `line` and `bar`, with one or more numeric series. Every chart can switch to a table. Omit `chart` for a table-only dataset. Column and series formats accept `number`, `currency`, `percent`, `text` and `date`. Percent formatting expects a fraction, for example `0.25` for 25%.

Series use the UI theme's palette by default. Set a series `color` only when it needs an explicit semantic color; otherwise leave it out to keep the chart consistent with the interface.

When the series legend does not fit, its arrows page through the remaining labels
on one line, keeping the legend clear of the plot on narrow screens.

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
    defaults: { region: 'North' },
    blocks: [
      { id: 'revenue', type: 'metric', metric: 'revenue', width: 3 },
      { id: 'sales-chart', type: 'dataset', dataset: 'sales', width: 9 },
      { id: 'sales-table', type: 'dataset', dataset: 'sales', view: 'table', width: 12 }
    ]
  }
}
```

The layout uses 12 columns on wide screens and collapses on smaller screens. Block IDs must be unique within a dashboard. The URL is `/dashboards/overview`; no page component is needed. A block that fails displays an error without hiding successful blocks.

The fragments above illustrate individual contracts. `samples/source-examples/dashy.config.ts` is the complete executable example, including consistent filters across metrics and datasets.

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
