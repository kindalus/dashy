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
| `select` with static or query options | select ("All" unless `required`) |
| `boolean` | select: All / Yes / No |
| `array` with static or query options | multiselect with a filter box |
| `string`, `number`, `select` or `array` with `search: true` | autocomplete (chips for arrays) |
| `range` of dates | date inputs with presets: year/month to date, last closed month/year, last 30 days, last 12 months |
| `array` without options | comma-separated text |

Selects, the period presets, Top N and the sidebar theme selector share one themed control rather than the browser's native select, so every list matches the theme and the multiselect. It follows the WAI-ARIA select-only combobox pattern:

- **Keyboard:** arrows, Home, End, PageUp and PageDown move; Enter or Space chooses; Escape closes without changing; typing jumps to the next option starting with those letters, also while closed.
- **Long lists:** more than eight options add a filter field.
- **Placement:** the list opens below, or above when there is more room there (for example the theme selector at the bottom of the sidebar), and is never clipped by cards or the scrolling sidebar.

The page menu on phones stays native, where the system picker is easier to use.

### Reserved query keys

`api_key`, `token`, `refresh`, `_from`, `_xf`, `_dd`, `_format`, `_sort`, `_top`, `_width`, `_height`, `_theme` and `_lang` belong to the engine and are never validated as parameters; they cannot be used as parameter names. `refresh=true` bypasses the result cache, `_from` holds the drillthrough origin, `_xf` the cross-filter origins and `_dd` the [drill-down](#drill-down) paths; `_format`, `_sort` and `_top` select an [export](#export). `token` carries an [embed token](embedding.md); `_format=svg`, `_width`, `_height`, `_theme` and `_lang` draw a dataset's chart as an [SVG image](#embedding).

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

The internal `sql` helper is implemented in `core/sql.ts`. `eq`, `in` and `range` build bound predicates; `previousRange` returns the [comparison range](#comparison-target-and-sparkline) of a date range. `where` combines non-empty predicates with `AND`. `fragment` accepts trusted SQL text and a values array. These helpers never infer business rules or filter column mappings.

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
| `cartesian` | `x`, `series[]` with `as` (`line`, `bar`, `area`, `scatter`), `axis` (`left`/`right`), `stack`, `smooth`; `xType` (`category`, `time`, `value`); `orientation` (`vertical`/`horizontal`) | lines, bars, areas, stacks, combinations, dual axes (use sparingly), scatter |
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

### Reference lines, trends and forecasts

Cartesian series can carry three analyses, computed in the browser from the rows already loaded:

```ts
chart: {
  type: 'line', x: 'month',
  series: [{
    key: 'revenue', label: 'Revenue',
    reference: [{ kind: 'average' }, { kind: 'constant', value: 1_000_000, label: 'Target' }],
    trend: 'linear',
    forecast: { periods: 6, method: 'seasonal', season: 12 }
  }]
}
```

- **`reference`:** dashed lines at the series' `average`, `median`, `min` or `max`, or at a `constant` `value`, labelled with `label` (default the kind, or `Target`) and the formatted value. Horizontal charts draw them across the value axis.
- **`trend: 'linear'`:** a dashed least-squares line, fitted against the row position on category axes, the date on time axes and the x value on value axes.
- **`forecast`:** projects `periods` (1–120) past the last row with `linear` (default), `holt` (a changing trend) or `seasonal` (additive Holt-Winters with `season` periods, e.g. 12 months), choosing smoothing parameters by one-step error. It draws a dashed line from the last actual value and a shaded band of about 95%: the regression prediction interval for `linear`, and ±1.96 × one-step RMSE × √horizon for `holt` and `seasonal`. A series that is never negative is not projected below zero. The band shows in the chart, not in the tooltip.

A forecast needs evenly spaced date labels on the x axis, in ascending order: `YYYY`, `YYYY-MM`, `YYYY-Qn`, or `YYYY-MM-DD` one day, week, month, quarter or year apart. Monthly, quarterly and yearly dates must fall on days 1–28, so month-end dates do not qualify; timestamps such as `2024-01-01 00:00:00` do not either, so format the period in SQL (`strftime(day, '%Y-%m')` or a cast to `DATE`). It also needs a value in every period and enough of them: 3 for linear, 4 for holt, two seasons for seasonal. Otherwise the chart shows the data with a note explaining why there is no forecast, for example after a filter leaves a month without sales. A last period that is still incomplete pulls the forecast down; leave it out of the query when that matters.

References, trend and forecast cannot be used on stacked series, and forecasts need a vertical chart with a category or time axis. With Top N, the Other row is not part of any statistic. Clicking a trend or forecast selects nothing. Tables, exports and the API show only the query's rows.

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

**Presentation defaults.** Lines are 2 px. Series longer than eight points hide their point markers, which reappear on hover. Areas fade towards the baseline. Bars round their ends by the theme's `--chart-bar-radius` (0 in Excel and Cognos); stacked segments stay square, separated by a hairline of the surface colour. The legend sits top left with square swatches. A single line or area on a category axis labels its last value, and one stack of lines or areas labels its total. Horizontal single-series bars name each bar above it, write the value at its end and hide the value axis. Date columns with `format: { style: "date", grain }` label the axis as periods (jan 2020). Value axes use short numbers (2,5 mi). Grid lines are dashed or solid per theme (`--chart-grid-style`).

**Dual axes.** `axis: "right"` remains available, but two value scales invite comparing heights that do not share a unit. Prefer a separate chart, a metric card or values indexed to a common base; the Maven sample no longer uses dual axes.

### Sorting, totals, subtotals and Top N

Every table column heading sorts: ascending, descending, then back to the query's order. Numbers and numeric strings sort numerically (integers beyond 2^53 exactly), text uses the project locale, and empty values stay last in both directions. Sorting changes the table only; charts keep the query's order. `defaultSort` sets the initial order.

`bar: true` on a numeric column draws an in-cell bar proportional to the column's largest value among the rows shown, behind the value. It is presentation only and never changes exports.

A column's `aggregate` declares how it combines across rows: `sum`, `count` (non-empty values), `min`, `max` and `avg` (numeric values only), or `{ ratio: [numerator, denominator] }`, which divides the two other columns' sums. Use a ratio for margins and rates; averaging row ratios gives the wrong total. Use `sum` on a count column only when rows cannot overlap, e.g. orders per country when every order has one country.

```ts
datasets: {
  products: {
    label: 'Products',
    query: 'products',
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'product', label: 'Product' },
      { key: 'revenue', label: 'Revenue', format: { style: 'currency', currency: 'EUR' }, aggregate: 'sum' },
      { key: 'profit', label: 'Profit', format: { style: 'currency', currency: 'EUR' }, aggregate: 'sum' },
      { key: 'margin', label: 'Margin', format: { style: 'percent' }, aggregate: { ratio: ['profit', 'revenue'] } }
    ],
    defaultSort: { column: 'revenue', direction: 'desc' },
    totals: true,              // a total row on every page
    subtotals: ['category'],   // group rows, outermost first, with a subtotal after each group
  },
  brands: {
    label: 'Revenue by brand',
    query: 'brands',
    columns: [{ key: 'brand', label: 'Brand' }, { key: 'revenue', label: 'Revenue', aggregate: 'sum' }],
    chart: { type: 'pie', category: 'brand', value: 'revenue' },
    topN: { by: 'revenue', options: [5, 10], default: 5, other: true }
  }
}
```

Totals and subtotals use every row of the result, not just the visible page; with Top N they cover the rows shown, including those combined into Other. Columns without `aggregate` stay empty in them, and "Total" goes in the label column: the chart's key column, else the first column without an aggregate. With subtotals, sorting orders rows within each group and orders the groups by their subtotal; sorting by a column the subtotal leaves empty keeps the groups in order of first appearance. Subtotal rows count towards the eight rows of a table page.

`topN` adds a selector (the options plus All) that keeps the rows with the highest `by` values, or the lowest with `order: 'bottom'`, in both the chart and the table. Rows without a `by` value are never kept; when no row has one, Top N shows the result unchanged. The chart keeps the query's order; the table applies its own sort. `default` may be `0` to start with All, and `options` defaults to `[5, 10, 25]`. `other: true` adds one row combining the rest, named `otherLabel` (default `Other`) in the `label` column (default the label column above). It always stays last, never filters when clicked and is never highlighted. It requires an aggregate on `by` and a pie, funnel, radar or category-axis cartesian chart, or no chart; on other charts a synthetic category would mislead. A real value equal to the Other label is still combined into Other when it falls outside the kept rows. Top N cannot be combined with subtotals.

A result that reached its row limit is incomplete, so it gets no totals, subtotals, Top N or Other row, and the table says so. Startup validation rejects unknown columns, self-referencing ratios, aggregates on grouping or label columns, and totals or subtotals without any aggregate.

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

Metric cards show values from one million in short form with three significant digits, following the project locale (`US$ 9,29 mi` in `pt`, `$9.29M` in `en`), so long values never wrap. The exact value stays in the tooltip and is read by screen readers. Set `format: { compact: false }` to always show the full value, or `compact: true` to shorten smaller values too. `compact` also works in dataset columns.

### Comparison, target and sparkline

A metric card can compare its value with another column of the same query row, show progress towards a target and draw a small trend line:

```ts
metrics: {
  revenue: {
    label: 'Revenue', query: 'summary', column: 'revenue',
    format: { style: 'currency', currency: 'EUR', decimals: 0 },
    compare: { column: 'previous_revenue', label: 'vs previous period' },  // as: 'percent' (default) | 'delta'; better: 'higher' (default) | 'lower'
    target: { column: 'budget' },        // or { value: 1_000_000, label: 'Budget' }
    sparkline: { dataset: 'monthly', value: 'revenue' }
  }
}
```

- **`compare`** shows the change from `column` as a signed percentage (`as: 'percent'`) or difference in the metric's format (`as: 'delta'`; for a percent metric, in percentage points such as `+5.0 pp`), with an arrow coloured by whether the change is good: `better: 'lower'` suits costs or delivery days. The arrow and sign always come with the text, never colour alone. A change that displays as zero reads as unchanged; a missing comparison value, or a zero base for a percentage, shows nothing.
- **`target`** draws a progress bar and "75% of target €1,000,000", from a column of the row or a constant `value`.
- **`sparkline`** draws a dataset's numeric `value` column in query order. Its query must accept the metric query's parameters, so it follows the same filters, including the block's cross-filter exclusions and `unfiltered` list. It is decorative: it is left out when the viewer cannot read that dataset or when its query fails, without affecting the value.

Comparison and target columns come from the metric's own query row, so they add no query. Build the previous period in SQL with `sql.previousRange(range, mode)`. With `period` (default), a range of whole calendar months (from the 1st to a month's last day) gives the same number of months just before it, so March compares with February, a quarter with the previous quarter and 2020 with 2019; any other range gives the same number of days just before it. `year` gives the same dates a year earlier (29 February becomes 28 February); use it for to-date ranges such as year to date, which are not whole months. It returns `undefined` without a valid date range, so return `NULL` then:

```ts
build: ({ source, params, sql }) => {
  const period = params.period as { from: string; until: string } | undefined
  const previous = sql.previousRange(period)
  const current = sql.where(sql.range('day', period))
  const prior = previous ? sql.where(sql.range('day', previous)) : sql.fragment('WHERE FALSE')
  return {
    text: `SELECT (SELECT SUM(amount) FROM ${source('sales')} ${current.text}) AS revenue,
                  (SELECT SUM(amount) FROM ${source('sales')} ${prior.text}) AS previous_revenue`,
    values: [...current.values, ...prior.values]
  }
}
```

### Tone, note and fallback

The query row can also decide how a value reads: its colour, a short note beside it, and what to show when there is no value. Each names another column of the same row:

```ts
metrics: {
  credit_limit: {
    label: 'Recommended credit', query: 'credit', column: 'limit',
    format: { style: 'currency', currency: 'AOA', decimals: 0 },
    fallback: 'reason',   // 'Not eligible' when limit is NULL
    tone: 'tone',         // 'success' | 'warning' | 'danger' | 'neutral'
    note: 'note'          // e.g. '-6m'
  }
}
```

- **`fallback`** is shown, as text, when `column` is `NULL`, so one metric can be a number for some rows and a reason for others.
- **`tone`** colours the value: `success`, `warning` or `danger`. Any other value, or `NULL`, is neutral. Colour is never the only signal: the value, its note or the description must say the same.
- **`note`** appears small beside the value and in its tooltip. A blank note is left out.

They come from the metric's own row, so they add no query. Text and date metrics need nothing extra: a text column shows as it is, and `format: { style: 'date' }` formats a date.

In dashboard data, a metric block carries `compare`, `target`, `sparkline`, `fallback`, `tone` and `note` when declared. `/api/metrics/:name` returns `{ value }`, plus `fallback`, `tone` and `note` when the metric declares them.

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

## Interaction: cross-filter, drillthrough and drill-down

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

The page shell is available as `GET /api/dashboard-shell/:name` (same parameters, `_xf` and `_dd`), returning `{ params, requests, missing, crossFilters, drilldowns, … }` without running queries.

### Drill-down

A dataset can declare levels that a user walks down **inside its block**: Category → Brand → Product, or Year → Quarter → Month → Day. Clicking a value shows the next level for that value; a breadcrumb (`↑`, `All › Computers › Contoso`) goes back. The rest of the dashboard is unchanged: drilling narrows only that block. Use cross-filter to filter other blocks.

The engine never infers the hierarchy from the data. Levels are listed in order, and **the value clicked at a level becomes a filter for every level below it**, in one of two ways:

| Level | How it filters deeper levels | Who defines the relationship |
| --- | --- | --- |
| Categorical (`param`) | The clicked value becomes that parameter | The deeper query's `WHERE` |
| Date (`range` + `grain`) | The clicked period start becomes a range: `2024-01-01` with `grain: "year"` is 2024-01-01 – 2024-12-31 | The engine, by period containment |

```ts
sales_drill: {
  label: "Sales",
  query: "by_category",
  columns: [{ key: "category", label: "Category" }, revenue],
  chart: { type: "bar", x: "category", series: [revenue] },
  drilldown: [
    { column: "category", param: "category" },
    { query: "by_brand", column: "brand", param: "brand",
      columns: [{ key: "brand", label: "Brand" }, revenue],
      chart: { type: "bar", x: "brand", series: [revenue] } },
    { query: "by_product", column: "product",
      columns: [{ key: "product", label: "Product", param: "productName" }, revenue] },
  ],
},
```

`by_brand` must accept `category`, and `by_product` both `category` and `brand`; their `WHERE` decides what "belongs to" means.

Date hierarchies usually share **one query**, whose grain is a bound value rather than SQL text:

```ts
// Query: SELECT CAST(date_trunc(?, order_date) AS DATE) AS period, SUM(revenue) AS revenue ... GROUP BY 1 ORDER BY 1
// with values [params.grain, ...]; grain is a select parameter with options year, quarter, month and day.
period_drill: {
  label: "Revenue by period",
  query: "sales_by_period",
  columns: [{ key: "period", label: "Period" }, revenue],
  chart: { type: "bar", x: "period", series: [revenue] },
  drilldown: [
    { column: "period", label: "Year", range: "period", grain: "year", set: { grain: "year" } },
    { column: "period", label: "Month", range: "period", grain: "month", set: { grain: "month" } },
    { column: "period", label: "Day", grain: "day", set: { grain: "day" } },
  ],
},
```

Level properties:

| Property | Meaning |
| --- | --- |
| `column` | Column holding the value a click drills into. Charts drill from any element of the row; tables from this column's cells. |
| `query` | This level's query; defaults to the dataset's. |
| `label` | Breadcrumb and menu name; defaults to the column's label. |
| `param` | Categorical levels: the parameter the clicked value sets. Array parameters receive `[value]`. |
| `range`, `grain` | Date levels: a date range parameter and the period length (`year`, `quarter`, `month`, `day`) of `column`'s values. Values must start each period (`date_trunc`); `YYYY` and `YYYY-MM` are also read. |
| `grain` alone | Formats the column as periods: `2024`, `Q1 2024` (`T1` in Portuguese), `Jan 2024`. Any date column can use `format: { style: "date", grain }`. |
| `set` | Fixed parameter values for this level's query, such as `{ grain: "month" }`. These parameters cannot also be dashboard filters. |
| `columns`, `chart` | This level's columns and chart, when they differ from the dataset's. |

Rules:

- **Validation at startup.** At least two levels. Every level but the last needs `param` or `range` (not both); the last needs neither. Each level's column, chart and table options must match its columns. Every deeper query must accept what an upper level passes, and every level's query must accept the dashboard's filters (or list them in `unfiltered`), like any block.
- **Never wider than the dashboard.** A date level intersects its period with the dashboard's range: with the dashboard on June 2024 – June 2025, clicking 2024 shows June – December 2024. A period entirely outside the filter is an error for that block only.
- **State.** The path travels in the URL as ordered `_dd=<block>:<value>` keys, so reloading, sharing and "back" reproduce it. It survives cross-filters and refresh. Applying new dashboard filters returns every block to its top level. Invalid blocks are ignored and extra levels trimmed.
- **Clicks.** When the clicked column also has a parameter annotation, the menu offers "Drill down to Brand" first, then cross-filter and drillthrough.
- **Downloads and images** use the current level. The Excel Filters sheet and image captions list the path, for example `Category: Computers › Brand: Contoso`. Printing shows the breadcrumb without its buttons.
- **API.** `/api/dashboard-shell`, `/api/dashboard-data`, `/api/dashboards` and `/api/dashboard-export` accept `_dd`. `/api/datasets/:name` always returns the top level.

## Export

Every dataset block has a Download menu with CSV and Excel. The file holds the block as shown: the dashboard's filters and cross-filter exclusions, the current sort and the Top N choice. It is served by the server, so it follows the same permissions, row limit and cache:

```text
GET /api/dashboard-export/:dashboard/:block?<filters>&_xf=…&_format=csv|xlsx&_sort=<column>:asc|desc&_top=<n>
```

`_format` defaults to `csv`. `_sort` must name a column of the dataset; without it the dataset's `defaultSort` applies, and an empty `_sort=` keeps the query's order (the Download menu always sends the table's current order). `_top` is `0` (all rows) or one of the dataset's `topN` options; without it, the dataset's initial choice applies. Options are checked before any query runs. Metric and unknown blocks return 404 and invalid options 400; errors loading the block keep their status (for example 403 when a dataset or query role denies access).

- **CSV:** UTF-8 with a byte order mark, a header of column labels, raw values (dot decimals, ISO dates; the computed Other row is rounded to 15 significant digits) and CRLF line ends, quoted per RFC 4180. It holds the data rows, including Top N's Other row, but not subtotal or total rows. Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, tab or carriage return) is prefixed with `'`, unless it is a number.
- **Excel:** one sheet with typed cells, number formats from the column formats, bold subtotal and total rows, a frozen header and fitted widths. Numeric strings (DuckDB returns many counts and sums as strings) become numbers in number, currency, percent and aggregated columns; in columns without a format only plain decimals do, so codes such as `00123`, `+244…` or `1e5` stay text. `text` columns and integers beyond 2^53 always stay text; give columns of codes or versions such as `1.10` `format: { style: 'text' }`. Date columns become dates; timestamps without a time zone are read as UTC, as in the UI. Percent columns without `decimals` use one or two decimals (`0.0#%`). Subtotal labels use the raw group value. A second sheet, Filters, lists the dashboard, the block, every dashboard filter (`All` when unset, `Not applied to this block` for the block's own cross-filters and `unfiltered` parameters), the rows exported, the sort, the generation time and, for incomplete results, a note. A data sheet that would be named Filters or History is named Data. The Filters sheet, summary rows and Top N's Other row follow the viewer's interface language (Filtros, Todos, Outros… in Portuguese). The workbook is written with a streaming writer: about a second for 100,000 rows of a few columns.

Files are named `<dashboard>-<block>-<YYYY-MM-DD>.<csv|xlsx>`. A result that reached its row limit exports what was returned, without totals, subtotals or Top N.

### Images and printing

In chart view, the Download menu also saves the chart as PNG (at twice its size) or SVG, generated in the browser from the chart's final frame, even mid-animation. The image carries the block's title and a caption, wrapped to the image width, with the filters that narrow the block (filters set to All, the block's own cross-filters and its `unfiltered` parameters are left out), so it stands on its own; files are named `<dashboard>-<block>.<png|svg>`. If the browser cannot produce the image, the block says so. Table view offers only the data formats.

**Print / PDF**, next to Refresh, opens the browser's print dialog, where "Save as PDF" makes a PDF. The printed page shows the title, a line with every filter value (noting the block a cross-filter does not apply to), the metric cards and the blocks, without navigation, filter controls or menus. Tables print every row rather than one page, up to 2,000 rows with a note pointing to the CSV and Excel downloads for more; they repeat their header on each page and show the total once at the end. Charts and cards are not split across pages; charts are redrawn without animation and scale to the paper width. Dark themes print with a light palette, charts included. The layout follows the browser's paper size and margins. There is no server-side PDF.

## Embedding

Charts and dashboards appear in other applications with signed tokens: a static SVG
of one dataset chart, and an interactive iframe of a dashboard or one dataset (mouse
only: tooltips, cross-filter and drill-down). See [embedding](embedding.md).

```ts
embed: { secret: process.env.DASHY_EMBED_SECRET!, origins: ["https://portal.example.com"], maxTtlSeconds: 3600 }
```

```text
POST /api/embed                         mint (API-key principals only; X-Dashy-Request: 1)
     { dashboard | dataset, params?, ttlSeconds?, language?, theme? }
  → { token, expiresAt, urls: { iframe, svg[] } }
GET  /embed/dashboards/:name?token=…    iframe page of a dashboard
GET  /embed/datasets/:name?token=…      iframe page of one dataset
GET  /api/embed/shell                   iframe shell and data, token in X-Dashy-Embed
GET  /api/embed/data/:request
GET  /api/datasets/:name?_format=svg    &_width= &_height= &_theme= &_lang= &token=
```

Tokens are HS256 JWTs with audience `dashy-embed`, naming one resource, its fixed
parameters, the minting key's roles, subject, language and theme. Fixed parameters
override request values, cross-filters and drill-down. A token opens only its
resource (403 elsewhere); expired, tampered or other-audience tokens return 401.
`/api/datasets/:name` accepts `_format=json` (the default) or `svg`; SVG works with
normal authentication too, and returns 400 for datasets without a chart.

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

## Interface language

```ts
defineProject({
  locale: "pt-AO",      // numbers and dates
  language: "pt",       // Dashy's interface: "en" or "pt"; default from locale
  languages: ["pt", "en"], // offered in the sidebar; false or [] hides the selector
  // …
});
```

Dashy's own text (buttons, menus, filter controls, empty and error states, table
footers, drill-down, chart notes, exports, error and sign-in pages) comes from a
message catalogue in `core/i18n.ts`, where every language has every message.
Without `language`, a locale starting with `pt` gives Portuguese and any other
English. Invalid values fail at startup with `Invalid Dashy language`.

The sidebar selector stores the viewer's choice in the `dashy_language` cookie
(path `/`, one year, `SameSite=Lax`; cleared when it equals the project language).
The server reads it, so the first response, `<html lang>` and exports are already
in that language; switching does not reload the page. A choice the project does
not offer is ignored. Numbers and dates follow the chosen language, keeping the
project locale when it is in that language (`pt-AO` stays `pt-AO` for Portuguese;
English uses `en`). `/api/catalog` returns `locale` (the project's) and
`language: { name, selectable }`. Labels the project defines are not translated.
`createAuth({ language })` sets the sign-in pages' language when the viewer has no
saved choice; otherwise they follow the browser's `Accept-Language`, then English.

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

The selected theme assigns colors by series position. Excel uses this palette:

| Position | Color             | Token       |
| -------- | ----------------- | ----------- |
| 1        | Green `#1f7a4d`   | `--chart-1` |
| 2        | Blue `#2f6fd6`    | `--chart-2` |
| 3        | Orange `#d4680a`  | `--chart-3` |
| 4        | Magenta `#c43d79` | `--chart-4` |
| 5        | Gold `#a07800`    | `--chart-5` |
| 6        | Purple `#7f56cf`  | `--chart-6` |

Every theme's palette is checked by `tests/palettes.test.ts`. Each colour sits in a lightness band (OKLCH L 0.43–0.77 on light surfaces, 0.48–0.67 on dark), is saturated enough not to read as grey (chroma at least 0.10) and has at least 3:1 contrast with the chart surface. Neighbouring colours, which colour adjacent series, differ by at least 15 (OKLab ΔE×100) for normal vision and 8 under simulated protanopia and deuteranopia. That is why some palettes alternate warm and cool hues. This is a manually selected categorical palette, not a color calculation based on
the values or series names. After six series it repeats. An explicit
`chart.series[].color` overrides the corresponding slot. To keep a particular
metric the same color in different charts regardless of order, set its `color`
explicitly. The theme does not yet assign colors by semantic key.

See [theme configuration](themes.md) for the nine built-in themes, project themes, the viewer theme selector and independent input,
button and panel corners. Metric values use a separate theme token (`--metric-color`).
