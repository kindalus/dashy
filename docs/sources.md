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

CSV, JSON and Parquet use DuckDB's native readers. JSON accepts tabular arrays or newline-delimited records. CSV expects a header row. Parquet supports hive partitions. A DuckDB database is attached read-only. SQLite uses Bun's native read-only driver and imports its table into the request's in-memory DuckDB instance. Excel uses ExcelJS, reads the selected worksheet, and imports its rows similarly.

Each data request gets its own DuckDB instance. The browser loads independent query groups in parallel; blocks sharing a query share a single request and execution. Different groups do not share source mounts or connections. The aggregate `/api/dashboards/:name` endpoint still uses one instance for its complete response, executes queries sequentially and mounts each source once. Connections close on success or failure; concurrent requests never share a connection or results. A refresh creates new sessions and reads sources again. Native file views may read their files for each query; this is not a transactional snapshot of external files.

## Limits and data types

- Query results default to 10,000 rows. Set `maxRows` per query, up to 100,000. `truncated` signals that more rows exist.
- A query connection is interrupted after 30 seconds. This interruption does not cancel an Excel workbook parse already in progress.
- Each DuckDB instance uses at most two threads and a configured memory limit of 512 MB. This is per request, not a server-wide limit.
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

## Add a source adapter

An adapter mounts a table or view on the supplied DuckDB connection. It runs once per source per request; multiple queries within an aggregate dashboard request reuse that mount. Independent browser requests mount their sources separately. It owns format-specific reading; the engine still handles queries, parameters, permissions and responses.

```ts
import { DashyEngine } from "../core/engine";
import { mountRows, type SourceAdapter } from "../core/sources";

const memory: SourceAdapter = async ({ connection, name }) => {
  await mountRows(
    connection,
    name,
    [
      { category: "A", amount: 10 },
      { category: "B", amount: 20 },
    ],
    ["category", "amount"],
  );
};

// In your project definition:
// adapters: { memory },
// sources: { demo: { type: 'memory', path: '' } }
const engine = new DashyEngine(project);
```

Register adapters in `project.adapters`; the web application and engine load them automatically. You can also override adapters through the engine constructor for tests. Keep credentials in the server environment and apply the remote system's authentication inside the adapter. Do not pass credentials through dashboard parameters.

Run `bun run seed` to regenerate all six sample formats from `samples/source-examples/data/orders.csv`.
