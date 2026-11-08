# Data sources

Source paths are supplied by trusted project configuration and resolved relative to `project.dataDir`. HTTP requests cannot override paths, tables or worksheets.

```ts
sources: {
  csv: { type: 'csv', path: 'orders.csv', delimiter: ',' },
  json: { type: 'json', path: 'orders.json' },
  sqlite: { type: 'sqlite', path: 'orders.sqlite', table: 'orders' },
  excel: { type: 'excel', path: 'orders.xlsx', sheet: 'Orders', headerRow: 1 },
  duckdb: { type: 'duckdb', path: 'orders.duckdb', schema: 'main', table: 'orders' },
  parquet: { type: 'parquet', path: 'orders/**/*.parquet' }
}
```

CSV, JSON and Parquet use DuckDB's native readers. JSON accepts tabular arrays or newline-delimited records. CSV expects a header row. A DuckDB database is attached read-only. SQLite uses Bun's native read-only driver and imports its table into the request's in-memory DuckDB instance. Excel uses ExcelJS, reads the selected worksheet, and imports its rows similarly.

## Globs and hive partitions

CSV, JSON and Parquet paths may be globs. A glob must be relative to `dataDir`: absolute globs and `..` are rejected, so `DASHY_DATA_DIR` decides which tree is readable. Plain paths keep the existing contract, where an absolute path is an external source.

```ts
sales: {
  type: 'parquet',
  path: 'gold/fact_sales/**/*.parquet',
  hive: { types: { year: 'INTEGER', month: 'INTEGER', day: 'INTEGER' } },
  unionByName: true,
},
stock_lots: { type: 'parquet', path: 'gold/fact_stock_lots/**/*.parquet', hive: { types: { month: 'VARCHAR' } } },
legacy: { type: 'parquet', path: 'archive/*.parquet', hive: false },
```

Hive partitioning is on by default for Parquet. `hive.types` sets partition column types (`VARCHAR`, `INTEGER`, `BIGINT`, `DOUBLE`, `DATE`, `TIMESTAMP`, `BOOLEAN`) instead of relying on inference. `unionByName` combines files whose schemas differ by column name, for example after a column was added. `hive: false` disables partition columns.

A glob that matches no files is a data state, not a configuration error. Startup logs a warning and continues. Queries over that source answer `503 Data unavailable for source <name>` without revealing the path, and recover as soon as files appear. A plain path that does not exist still fails startup. Packaging copies the static directory of a glob when it has files; otherwise it is supplied at runtime through `DASHY_DATA_DIR`.

## Sessions

All requests share one DuckDB instance per process, with process-wide memory and thread limits ([limits](contracts.md#limits-and-cache)). Each data request leases its own connection; temporary views are connection-local, and the connection closes when the request ends. ATTACH is instance-wide, so built-in DuckDB sources use an alias unique to the lease and detach it on release. Custom adapters receive `scope.id` and `scope.onRelease(cleanup)` for the same purpose. Configuration is locked after startup, so adapters cannot change settings with `SET`. The browser loads independent query groups in parallel; blocks sharing a query share a single request and execution. Different groups do not share source mounts or connections. The aggregate `/api/dashboards/:name` endpoint still uses one instance for its complete response, executes queries sequentially and mounts each source once. Connections close on success or failure; concurrent requests never share a connection or results. A refresh creates new sessions and reads sources again. Native file views may read their files for each query; this is not a transactional snapshot of external files.

## Limits and data types

- Query results default to 10,000 rows. Set `maxRows` per query, up to 100,000. `truncated` signals that more rows exist.
- A query is interrupted after `limits.queryTimeoutMs` (default 30 seconds), including source mounting and time spent waiting for a connection. HTTP cancellation interrupts the request's connection and prevents subsequent sources and SQL from running. ExcelJS cannot stop a workbook parse already in progress; Dashy checks cancellation as soon as parsing returns and skips row import. Custom adapters receive an optional `signal` for cooperative cancellation.
- DuckDB uses `limits.threads` (default 2) and `limits.memory` (default 1 GB) for the whole process. At most `limits.maxConcurrentQueries` sessions run at once; others queue, then receive `503` with `Retry-After`.
- SQLite and Excel imports are capped at 100,000 rows. For larger datasets, convert to CSV/Parquet or use DuckDB directly.
- Excel `.xlsx` files are limited to 100 MB compressed file size. This does not bound decompressed memory. Use trusted, prepared workbooks; there is no upload endpoint.
- Excel headers must be unique and non-empty. Dates become ISO strings. Formulas use cached results; Dashy does not recalculate Excel formulas. Missing cached results and Excel cell errors fail the import.
- Legacy binary `.xls` is not supported. Convert it to `.xlsx` before configuring the source.
- SQLite BLOBs require a custom adapter. Integers outside JavaScript's safe range are preserved as strings.

For imported SQLite/Excel columns, set explicit types when inference is insufficient, particularly for empty or all-null columns:

```ts
{ type: 'excel', path: 'orders.xlsx', sheet: 'Orders',
  columns: { date: 'DATE', units: 'BIGINT', revenue: 'DOUBLE' } }
```

Supported explicit types are `VARCHAR`, `DOUBLE`, `BIGINT`, `BOOLEAN`, `DATE` and `TIMESTAMP`. Without overrides, imported numeric columns become `DOUBLE`, boolean columns become `BOOLEAN`, and mixed/text columns become `VARCHAR`. Native CSV/JSON/Parquet readers perform their own type inference.

SQLite, Excel and custom `mountRows` imports use DuckDB's native appender.
Values are passed as data and DuckDB applies the target column conversions.
Imports yield to the event loop every 2,048 rows and close the appender even if
a conversion fails.

## Add a source adapter

An adapter mounts a table or view on the supplied DuckDB connection. It runs once per source per request; multiple queries within an aggregate dashboard request reuse that mount. Independent browser requests mount their sources separately. It owns format-specific reading; the engine still handles queries, parameters, permissions and responses.

```ts
import { DashyEngine } from "../core/engine";
import { mountRows, type SourceAdapter } from "../core/sources";

const memory: SourceAdapter = async ({ connection, name, signal }) => {
  await mountRows(
    connection,
    name,
    [
      { category: "A", amount: 10 },
      { category: "B", amount: 20 },
    ],
    ["category", "amount"],
    {},
    signal,
  );
};

// In your project definition:
// adapters: { memory },
// sources: { demo: { type: 'memory', path: '' } }
const engine = new DashyEngine(project);
```

Register adapters in `project.adapters`; the web application and engine load them automatically. You can also override adapters through the engine constructor for tests. Keep credentials in the server environment and apply the remote system's authentication inside the adapter. Do not pass credentials through dashboard parameters.

Run `bun run seed` to regenerate all six sample formats from `samples/source-examples/data/orders.csv`.
