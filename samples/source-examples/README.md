# Source examples

A small synthetic dataset of 12 orders represented in CSV, JSON, SQLite, Excel,
DuckDB and Parquet. The two dashboards show a sales overview and format previews.

```sh
bun run dev --with-sample source-examples
# Regenerate the other formats from the supplied CSV, if needed:
bun run seed
```

The data is included. Its totals are 6,420 EUR, 228 units and 12 orders. This sample
is intended for adapter examples and integration tests; use `maven-analytics` for
a larger retail demonstration.
