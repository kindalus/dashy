# Samples

Dashy discovers immediate subdirectories of `samples/` containing a
`dashy.config.ts`, `dashy.config.js` or `dashy.config.mjs` default project export,
in that precedence order. Folder names use letters, numbers, hyphens and
underscores, starting with a letter or number. No central registry is required.

```text
samples/
  maven-analytics/
    dashy.config.ts
    queries.ts
    data/
    README.md
  source-examples/
    dashy.config.ts
    data/
    README.md
```

```sh
bun run dashy samples
bun run start --with-sample maven-analytics
bun run dev --with-sample source-examples
```

The CLI reads the chosen configuration and data in place. It never overwrites the
root project or remembers a selected sample. Without the flag, it loads the root
configuration. A missing or incomplete sample fails with a list of available
names. Run these commands from the project root.

To add a sample, create a folder with a valid project export and its source files.
Use `dataDir: './data'` for data next to the config. Relative data directories are
resolved against the config file, not the shell's working directory. Configs are
trusted executable server code. Restart the server after editing one.

`bun run build` bundles each sample's TypeScript configuration and local imports
into `.output/samples/<name>/dashy.config.js`, and copies its data and supporting
non-code files. `.output/dashy.mjs` provides the same CLI for deployment. The build
does not activate a sample. A new self-contained JS or Bun-compatible TS sample
can also be added to a deployed `samples/` folder without rebuilding the server.
Samples importing third-party packages must ship those runtime dependencies too.

## Verification

`bun test` covers discovery, empty defaults, invalid names and arguments, missing
data, relative paths and selection without overwriting the root config. Maven
integration tests cover totals, every dashboard, filters and row limits. The
expected totals were independently calculated from the supplied CSVs.

`bun run check:build` starts the packaged CLI outside the repository with no
sample, each supplied sample, and a sample added after building. It checks SSR,
client assets, API results and returning to the empty default.

Manual Chrome checks on 2026-10-22 verified the empty mobile workspace, retail
charts, country/channel filters, chart-to-table switching, detail text/number/
boolean filters, pagination and mobile overflow. The checked pages had no
console errors or warnings.
