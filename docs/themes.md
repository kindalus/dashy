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
| `excel`       | White surfaces, green header and metrics, moderately saturated categorical chart colors | `none`          |
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

Excel's metric values use `#217346`. Its chart palette uses moderately saturated green, blue,
gold, teal, purple and orange tones; see [the exact colors](contracts.md#chart-palette).
Chart text, axes, grid, legend and tooltips also follow the theme.

## Implementation

`core/theme.ts` defines the typed names, corner styles, defaults and startup
validation. Unknown theme names, styles and properties fail with a configuration
error. The resolved theme is included in the catalog and emitted as HTML
attributes during server rendering, so CSS applies before the first paint.

`src/theme.css` imports the eight palettes from `src/themes/` and the shared
corner rules from `src/themes/corners.css`. `src/styles.css` uses semantic tokens
such as `--metric-color`, `--nav-text`, `--radius-input`, `--radius-button` and
`--radius-panel`. `src/charts.ts` reads chart tokens from computed styles.
