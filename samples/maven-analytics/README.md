# Maven Analytics: Global Electronics Retailer

Run from the Dashy root:

```sh
bun run dev --with-sample maven-analytics
# Or after bun run build:
bun run start --with-sample maven-analytics
```

The CSV files are included, so startup needs no network connection or account.
The five dashboards cover overview, products, customers, stores and order detail.
They demonstrate joins, shared queries, metrics, line and bar charts with multiple
series, reusable datasets, date ranges, select/string/number/boolean parameters,
currency and percentage formatting, and paginated tables.

## Data provenance

- Dataset: [Global Electronics Retailer](https://mavenanalytics.io/data-playground/global-electronics-retailer), distributed by Maven Analytics; source credited to Microsoft.
- [Original ZIP](https://maven-datasets.s3.amazonaws.com/Global+Electronics+Retailer/Global+Electronics+Retailer.zip), retrieved 2026-10-22.
- Maven lists the license as **Public Domain**. The business and its customer data are fictitious.
- `data/Data_Dictionary.csv` is the publisher's field dictionary.
- The archive contains 62,884 sales lines, 15,266 customers, 2,517 products, 67 stores and 11,215 exchange rates. Sales span 2016-01-01 through 2021-02-20.
- `Customers.csv` was transcoded from Windows-1252 to UTF-8 for DuckDB. All records and field values were retained. The other CSVs are unchanged.

## Calculation rules

Revenue is quantity multiplied by the product's published USD list price. Gross
profit subtracts quantity multiplied by the published USD unit cost. These are
list-price estimates; the source has no actual transaction prices, discounts,
taxes or returns. Orders count distinct order numbers, not sales lines. Customers
count distinct buyers in the filtered sales.

All summary amounts are USD. Order detail also shows the order currency, daily
exchange rate, and the estimated amount converted to that currency. Local amounts
are never summed across currencies. Store 0 represents online sales. Customer
country filters use the customer's country, while the stores table shows the
store's country. A missing delivery date is shown as missing, without assuming
that the order has not been delivered.

The detail query returns at most 1,000 lines and reports truncation. Narrow the
filters to inspect other periods or selections. Aggregate queries use the full
dataset, independent of this detail limit.

## Files

`dashy.config.ts` defines the project and presentation. `queries.ts` contains the
joins, parameter binding and aggregates. `data/` holds the six supplied CSVs,
including the dictionary. Paths are resolved relative to the selected config.
