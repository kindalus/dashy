# Themes and corners

Select a theme for one run with `--theme`:

```sh
bun run dev --theme chromeos
bun run dev --with-sample maven-analytics --theme claude-code
bun run start --theme macos
# From a deployed .output directory:
bun dashy.mjs start --theme chatgpt
```

The flag works with `dev` and `start`, with your own project or a sample. It takes
precedence over the configured theme, including any corner overrides, and uses
the selected theme's default corners. No configuration files are modified and
no rebuild is needed to switch themes. An unknown name fails before startup and
lists the available themes. Without the flag, Dashy uses the project's theme.

Set `theme` in the project passed to `defineProject`. With `--with-sample`, edit
`samples/<name>/dashy.config.ts`; otherwise edit the root `dashy.config.ts`.
Restart the server after changing configuration. Viewers can also switch themes
from the sidebar without a restart; see [viewer selection](#viewer-selection).

```ts
theme: {
  name: "chromeos",
  corners: "rounded",
},
```

## Included themes

These are Dashy interpretations of each visual style, using local font stacks.
No remote fonts or theme resources are required.

| Name          | Appearance                                                                              | Default corners |
| ------------- | --------------------------------------------------------------------------------------- | --------------- |
| `excel`       | White surfaces, green header, cell-like metric cards, formula bar and sheet tabs        | `none`          |
| `chromeos`    | Pale blue canvas, rounded surfaces, blue accents and soft shadows                       | `rounded`       |
| `chatgpt`     | White and neutral gray surfaces, charcoal controls, muted sage metrics                  | `rounded-lg`    |
| `claude-code` | Dark warm surfaces, monospace text, terracotta accents                                  | `rounded-sm`    |
| `macos`       | Light gray canvas, system typography, blue accents and subtle shadows                   | `rounded-md`    |
| `power-bi`    | Light gray report canvas, dark top bar with yellow highlights, white cards with soft shadows, blue/navy/orange data colors | `rounded-sm`    |
| `microstrategy` | Cool gray canvas, slate top bar, red accents, blue/orange/teal data colors           | `rounded-sm`    |
| `cognos`      | Neutral gray canvas, near-black top bar, square controls, blue accents, IBM Carbon-style categorical colors | `none`          |

Omitting `theme` selects Excel. Omitting `name` also selects Excel. Omitting
`corners` keeps the chosen theme's defaults. The Dashy symbol keeps its fixed
shape and colors across themes. Sidebar links use gray tones distinct from the
group headings; the active item uses the theme accent.

## Viewer selection

A **Theme** selector at the bottom of the left sidebar lets each viewer switch
themes instantly, without reloading the page or restarting the server. Charts
redraw with the new palette.

- **Persistence:** the choice is kept in the `dashy_theme` cookie (one year,
  `SameSite=Lax`, readable by the page). The server reads it while rendering,
  so the next visit paints in the chosen theme without a flash. Choosing the
  project theme clears the cookie.
- **Corners:** a chosen theme uses its own default corners. The project theme
  keeps any configured corner overrides.
- **Which themes:** `selectable` defaults to `true`, offering every theme.
  A list limits the choices and must include `name`; `false` (or an empty list)
  hides the selector. Unknown or unoffered cookie values are ignored.
- **`--theme`:** sets the default for that run and keeps the selector. If
  `selectable` is a list without that theme, the run adds it.
- **Small screens:** the sidebar, and with it the selector, is hidden below
  720 px; those viewers see their saved or the project theme.

```ts
theme: {
  name: "excel",
  selectable: ["excel", "power-bi", "cognos"],
},
```

## Independent corners

Choose one style for everything, or override inputs, buttons and panels separately:

```ts
theme: {
  name: "excel",
  corners: {
    inputs: "rounded-sm",
    buttons: "rounded",
    panels: "rounded-lg",
  },
},
```

Unspecified families retain the selected theme's default. The canonical spelling
is `rounded-sm`, `rounded-md` or `rounded-lg`.

| Style        | Inputs | Buttons        | Panels |
| ------------ | ------ | -------------- | ------ |
| `none`       | 0 px   | 0 px           | 0 px   |
| `rounded-sm` | 4 px   | 4 px           | 4 px   |
| `rounded-md` | 8 px   | 8 px           | 8 px   |
| `rounded-lg` | 16 px  | 16 px          | 16 px  |
| `rounded`    | 16 px  | Pill (9999 px) | 24 px  |

Inputs include selects and date fields. Button corners also apply to navigation
links, chart/table toggles and pagination. Panels include filter bars, metric and
dataset cards, and error banners. Native checkbox styling follows the browser.

## Chart colors

Each theme has six categorical colors, assigned in declared series order and
repeated after the sixth. They are not derived from values or series names.
An explicit `chart.series[].color` takes precedence. Use that override when a
series must keep a semantic color across charts or themes; verify its contrast
on both light and dark surfaces if both are used.

All eight palettes pass the lightness, saturation, contrast and colour-vision checks
in `tests/palettes.test.ts`; see [the exact colors and thresholds](contracts.md#chart-palette).
Chart text, axes, grid, legend and tooltips also follow the theme, and two tokens
shape the marks: `--chart-grid-style` (`solid` or `dashed`) and `--chart-bar-radius`
(pixels).

## Signatures

Every theme adds details that make it recognizable at a glance. They only change
presentation; data, filters and exports are the same in every theme.

| Theme | Signature |
| --- | --- |
| `excel` | The top bar shows the dashboard and project. A formula bar below it shows the applied filters as one expression. Metric cards look like cells with a column reference (B, C, …). Tables are gridded, with column letters, in-cell data bars in a green gradient and a status line with average, count and sum. The main dashboards appear as sheet tabs at the bottom. |
| `power-bi` | Filters move to a pane on the right, one card per filter (on screens wider than 1150 px). Metric cards show the value above its label. Block tools appear on hover or focus. The main dashboards appear as page tabs with a yellow marker. |
| `microstrategy` | The main dashboards appear as chapters in the top bar, the current one underlined in red. Data panels have a title strip in small capitals. Changes and set filters use red chips. |
| `cognos` | Tiles sit on grey layers without borders or shadows. Filters keep labelled, underlined fields. Metric values use light numerals, changes appear as coloured tags, the active navigation item has a blue indicator and the primary button an arrow. |
| `chromeos` | Tonal surfaces without borders or shadows, pill navigation, filter chips that show a check when set, and the first metric in a tonal container. |
| `macos` | A translucent sidebar with a filled blue selection, the title in the toolbar, and filters and actions in one toolbar row without a box. |
| `chatgpt` | No boxes: sections are separated by space and hairlines in a narrow centred column. Metrics are loose numbers between hairlines, controls are pills, and charts are in focus: the main series in green, the rest in grey. |
| `claude-code` | A command line at the top holds the filters as flags (`❯ dashy overview --period 2020`). Panel titles start with ⏺, sparklines and bars are drawn in blocks, tables use dashed rules and a status line shows the request count and load time. |

## Shared presentation

- **Filters** are chips such as "Period: 2020". A chip opens its control in a popover;
  Apply applies every change at once. The first three are shown, the rest behind
  "+ N filters", which also counts how many of them are set.
- **Updated** time sits in the top bar on wide screens and in the page on phones.
- **Metric cards** never wrap values: from one million they use short numbers
  (see [metrics](contracts.md#metrics)). Sparklines have an area and a dot on the latest value.
- **Charts** follow the [presentation defaults](contracts.md#chart-types). Horizontal
  single-series bars name each bar above it and write its value at the end.
- **Page tabs, chapters and sheet tabs** list the dashboards that open on their own;
  detail dashboards with required parameters are reached by drillthrough.

## Implementation

`core/theme.ts` defines the typed names, corner styles, defaults and startup
validation. Unknown theme names, styles and properties fail with a configuration
error. The resolved theme is included in the catalog and emitted as HTML
attributes during server rendering, so CSS applies before the first paint.

`src/theme.css` imports the eight palettes from `src/themes/` and the shared
corner rules from `src/themes/corners.css`. `src/styles.css` uses semantic tokens
such as `--metric-color`, `--nav-text`, `--radius-input`, `--radius-button` and
`--radius-panel`. `src/charts.ts` reads chart tokens from computed styles.
