# Dashboard spec, draft v1

The spec is the contract between the model, the server and the renderer. It is plain JSON
and lives in `packages/shared/src/spec/` as Zod schemas. This document is the design. **The
implementing agent turns it into Zod 4 schemas and adjusts details, but must keep the
principles:**

1. **JSON only.** No functions, no code strings, no HTML.
2. **Data is referenced, never inlined.** Panels bind to query results by `refId`.
3. **Queries are templates.** Variables are declared, typed and bound safely.
4. **Formatting is named** (`{"$fmt": …}`) or an ECharts string template.
5. **Versioned.** `specVersion` allows migrations later.

---

## Types (TypeScript sketch)

```ts
type DashboardSpec = {
  specVersion: 1
  title: string
  description?: string
  timezone?: string                        // IANA, default: browser
  time: TimeDefault                        // default range of the built-in time variable
  variables: Variable[]                    // the time variable is implicit and not listed here
  panels: Panel[]
  annotations?: Annotation[]               // dashboard-wide sets of markers, e.g. deploys, ≤ 10
}

// ---------------------------------------------------------------- variables
type Variable =
  | {
      kind: 'custom'
      name: string                          // [a-z][a-z0-9_]*, referenced as $name / :name
      label?: string
      options: string[]                     // allowed values
      default: string | string[]
      multi?: boolean
    }
  | {
      kind: 'query'                         // options come from a source, e.g. label values
      name: string
      label?: string
      source: QueryTemplate                 // must return one string field
      default?: string | string[]
      multi?: boolean
      includeAll?: boolean
    }
  | {
      kind: 'text'                          // free text, bound as a parameter only
      name: string
      label?: string
      default: string
      pattern?: string                      // optional regex the value must match
    }
  | {
      kind: 'interval'                      // a duration to pick, such as the rate window
      name: string
      label?: string
      options: string[]                     // durations: '1m', '5m', '1h'
      default: string                       // one of the options
    }

// The built-in time variable (always present, not listed in `variables`):
//   default range lives in `time`, values exposed as $__from, $__to, $__range, $__interval
//   (PromQL, LogQL), :__from, :__to (SQL), {"$var": "__from"}, "__to", "__interval" (search), and
//   $__from, $__to as ISO times, $__from_ms, $__to_ms, $__from_s, $__to_s as epoch numbers (HTTP).
type TimeDefault = { from: string; to: string }   // 'now-7d' | 'now' | ISO 8601

// ---------------------------------------------------------------- queries
type QueryTemplate =
  | { refId: string; connector: string; language: 'promql'; expr: string; step?: string; instant?: boolean }  // step: '1m' or '$interval'
  | { refId: string; connector: string; language: 'sql'; sql: string }            // named params :var
  | { refId: string; connector: string; language: 'logql'; expr: string; step?: string; instant?: boolean }
  | { refId: string; connector: string; language: 'search'; index: string; body: JsonWithVars }  // Elasticsearch, OpenSearch
  | { refId: string; connector: string; language: 'http'; method?: 'GET' | 'POST'; path: string;
      query?: Record<string, string>; body?: JsonWithVars; extract?: HttpExtract }  // $name in path and query
  | { refId: string; connector: string; language: 'redis'; command: string; args?: string[] }  // a read command, $name in args
  | { refId: string; connector: string; language: 'mongodb'; collection: string; pipeline: JsonWithVars[] }  // Extended JSON stages

// Structural variable reference inside JSON bodies: { "$var": "service" }
type JsonWithVars = unknown

type HttpExtract = {
  rows?: string                             // JSON pointer to the array of rows, e.g. "/data/items"; default the whole response
  fields?: { name: string; pointer: string; type?: 'time' | 'number' | 'string' | 'boolean'; unit?: 's' | 'ms' }[]
}                                           // no fields: every value of the rows, nested ones as dotted names

// ---------------------------------------------------------------- panels
type Panel = {
  id: string                                // stable slug, e.g. "error-rate-by-service". Used for @mentions and diffs.
  title: string
  description?: string
  grid: { x: number; y: number; w: number; h: number }   // 12-column grid, h in rows of 40px
  queries: QueryTemplate[]                  // 1..4
  view: StatView | ChartView | TableView
}

type StatView = {
  kind: 'stat'
  ref: string                               // refId
  field?: string                            // default: first number field
  reduce: 'last' | 'first' | 'max' | 'min' | 'mean' | 'sum' | 'count'
  format: Formatter
  subtitle?: string                         // plain text, supports {{ref.reduce}} tokens rendered by us
  compare?: { ref: string; reduce: StatView['reduce']; label: string }   // "baseline 0.3%"
}

type TableView = {
  kind: 'table'
  ref: string
  columns: { field: string; label?: string; format?: Formatter; align?: 'left' | 'right' }[]
  sort?: { field: string; dir: 'asc' | 'desc' }
  limit?: number                            // ≤ 500
}

type ChartView = {
  kind: 'chart'
  recipe?: { id: string; variants: string[] }   // where it came from, for people; drawing ignores it
  prepare: PrepareKind                      // how the adapter prepares the data; default 'cartesian'
  roles: Record<string, string | string[]>  // the column of each role the option's @role tokens name
  limit?: number                            // categories kept, for pies, funnels and ranked bars
  // A JSON subset of an ECharts option, filled from a chart recipe. The adapter owns: dataset,
  // grid, theme, animation, tooltip.renderMode and anything security-relevant. Allowed series
  // types: line, bar, scatter, pie, heatmap, gauge, boxplot, candlestick, treemap, sunburst,
  // sankey, graph, funnel, radar, parallel, map. Anything else fails validation. Series never
  // hold data: the adapter builds it from the queries, trees and graphs included.
  option: EChartsOptionJson
  datasets: { ref: string; transform?: DatasetTransform }[]   // becomes option.dataset[i]
  markers?: { annotation: string }[]        // show dashboard annotations on this chart
}

type PrepareKind =
  | 'cartesian' | 'shares' | 'ranked' | 'groups' | 'items' | 'matrix' | 'bins' | 'boxplot'
  | 'tree' | 'graph' | 'radar' | 'calendar' | 'gauge' | 'kpi' | 'regions' | 'points'
  | 'parallel' | 'facets' | 'waterfall' | 'none'

type DatasetTransform =
  | { type: 'filter'; field: string; in: string[] }
  | { type: 'sort'; field: string; dir: 'asc' | 'desc' }

// ---------------------------------------------------------------- formatting
// Anywhere ECharts accepts a formatter (axisLabel, tooltip.valueFormatter, label), the spec may use:
//   - an ECharts string template: "{value} ms"
//   - a named formatter:          { "$fmt": "bytes", "base": 1024 }
type Formatter = string | NamedFormatter

type NamedFormatter =
  | { $fmt: 'number'; decimals?: number; compact?: boolean }
  | { $fmt: 'percent'; decimals?: number; input?: 'ratio' | 'percent' }   // ratio: 0.084 → 8.4%
  | { $fmt: 'bytes'; base?: 1000 | 1024; decimals?: number }
  | { $fmt: 'duration'; unit: 'ns' | 'us' | 'ms' | 's'; decimals?: number }
  | { $fmt: 'si'; unit?: string; decimals?: number }
  | { $fmt: 'currency'; code: string; decimals?: number }
  | { $fmt: 'datetime'; pattern?: 'time' | 'date' | 'datetime' | 'relative' }

// ---------------------------------------------------------------- annotations
type Annotation = {
  id: string                                // slug, e.g. "deploys"; charts name it in `markers`
  label: string                             // shown in each marker's tooltip, e.g. "deploy"
  color?: MarkerColor                       // default '@ink'
  query: QueryTemplate                      // must return a time field and a text field
  timeField: string
  textField: string
}

// A theme token, never a free colour, so a set reads in the light and the dark scheme:
// the text colour or one of the series colours.
type MarkerColor =
  | '@ink' | '@palette.0' | '@palette.1' | '@palette.2' | '@palette.3' | '@palette.4' | '@palette.5'
```

## The schemas

The Zod schemas are in `packages/shared/src/spec/` and `packages/shared/src/formatters/`. Where
they differ from the sketch above, the schemas win:

- Every object is strict: an unknown key is an error, so nothing rides along in a spec.
- `option` holds JSON values only (`z.json()`), so a function or `undefined` fails to parse.
- A chart option may use tokens the adapter replaces: `@role` for a role's column, and theme
  colours such as `@ink`, `@palette.1` or `@scale.low`. A role a view does not name is inferred:
  the x is the first time or text column, and the values are the number columns.
- Queries are `sql`, `promql`, `logql`, `search`, `http`, `redis` and `mongodb`.
- A query-backed variable's `source` has no `refId`.
- Time expressions are `now`, `now-<n><unit>` (units `s m h d w M y`) or an ISO 8601 timestamp
  with an offset.
- An annotation's `color` is a theme token (`@ink`, `@palette.0` to `@palette.5`), replaced by
  the renderer like the option's tokens.
- An "All" choice of a query-backed variable with `includeAll` has the value `$__all`.
- Formatter defaults: `number` 2 decimals, `percent` 1 decimal with `input: 'ratio'`, `bytes`
  base 1024, `duration`, `si` and `bytes` 1 decimal, `datetime` pattern `datetime`. Numbers use
  English grouping (`1,284`) and dates read `26 Sep, 14:02`.

## Validation beyond the schema

The Zod schema catches shape errors. `dashboards/validate` (`validateSpec`) also checks:

- every `connector` exists and runs the query's language;
- every query binds with the declared variables, exactly as it will at run time: an unknown or
  misplaced variable, a multi-value variable where one value fits (`env="$services"`), or a SQL
  template that is not one read statement are all reported when the spec is saved;
- `refId`s are unique within a panel, and every `ref` in a view points at one of them;
- panel, annotation and variable names are unique, and chart `markers` name an annotation;
- a variable's default is among its options, and a text variable's pattern compiles and matches
  its default;
- `option` passes the ECharts allowlist: top-level keys `xAxis`, `yAxis`, `series`, `legend`,
  `tooltip`, `visualMap` and `dataZoom`; series types `line`, `bar`, `scatter`, `pie`, `heatmap`
  and `gauge`; no `data` in a series; no `renderMode`, `appendToBody` or `className`, which the
  renderer sets; every `$fmt` object is a valid named formatter; no string longer than 500
  characters (a cheap guard against smuggled payloads);
- the time zone is known, and the default time range runs forwards and fits the `maxRangeDays` of
  every connector the spec uses;
- the grid has no overlaps: the validator moves an overlapping panel down rather than failing.

Validation errors go back to the model as structured tool results
(`{ path: 'panels[3].view.ref', message: 'Unknown refId "C".' }`) so it can repair them.

## Example: "Checkout incident · 26 Sep", v3

A dashboard about a checkout incident, abbreviated to three panels.

```json
{
  "specVersion": 1,
  "title": "Checkout incident · 26 Sep",
  "description": "Error rate, latency and failed orders for checkout around deploy #481.",
  "time": { "from": "2026-09-26T13:30:00+02:00", "to": "2026-09-26T15:00:00+02:00" },
  "variables": [
    { "kind": "custom", "name": "env", "options": ["prod", "staging"], "default": "prod" }
  ],
  "annotations": [
    {
      "id": "deploys",
      "label": "deploy",
      "color": "@ink",
      "query": {
        "refId": "D", "connector": "postgres-orders", "language": "sql",
        "sql": "SELECT deployed_at AS time, 'deploy #' || id AS text FROM deploys WHERE service IN ('checkout-svc','payments-svc') AND deployed_at BETWEEN :__from AND :__to"
      },
      "timeField": "time",
      "textField": "text"
    }
  ],
  "panels": [
    {
      "id": "error-rate-peak",
      "title": "Error rate · peak",
      "grid": { "x": 0, "y": 0, "w": 4, "h": 3 },
      "queries": [
        { "refId": "A", "connector": "prometheus-prod", "language": "promql",
          "expr": "sum(rate(http_requests_total{service=\"checkout-svc\",env=\"$env\",code=~\"5..\"}[1m])) / sum(rate(http_requests_total{service=\"checkout-svc\",env=\"$env\"}[1m]))" }
      ],
      "view": {
        "kind": "stat", "ref": "A", "reduce": "max",
        "format": { "$fmt": "percent", "decimals": 1, "input": "ratio" },
        "compare": { "ref": "A", "reduce": "first", "label": "baseline" }
      }
    },
    {
      "id": "error-rate-by-service",
      "title": "Error rate by service, 1m",
      "grid": { "x": 0, "y": 3, "w": 12, "h": 7 },
      "queries": [
        { "refId": "A", "connector": "prometheus-prod", "language": "promql", "step": "1m",
          "expr": "sum by (service) (rate(http_requests_total{service=~\"checkout-svc|payments-svc\",env=\"$env\",code=~\"5..\"}[1m])) / sum by (service) (rate(http_requests_total{service=~\"checkout-svc|payments-svc\",env=\"$env\"}[1m]))" }
      ],
      "view": {
        "kind": "chart",
        "datasets": [{ "ref": "A" }],
        "markers": [{ "annotation": "deploys" }],
        "option": {
          "xAxis": { "type": "time" },
          "yAxis": { "type": "value", "axisLabel": { "formatter": { "$fmt": "percent", "decimals": 1, "input": "ratio" } } },
          "tooltip": { "trigger": "axis", "valueFormatter": { "$fmt": "percent", "decimals": 2, "input": "ratio" } },
          "legend": { "top": 0, "right": 0 },
          "series": [{ "type": "line", "showSymbol": false }]
        }
      }
    },
    {
      "id": "slowest-endpoints",
      "title": "Slowest endpoints",
      "grid": { "x": 6, "y": 10, "w": 6, "h": 5 },
      "queries": [
        { "refId": "A", "connector": "prometheus-prod", "language": "promql", "instant": true,
          "expr": "topk(10, histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{env=\"$env\"}[$__range]))))" }
      ],
      "view": {
        "kind": "table", "ref": "A",
        "columns": [
          { "field": "route", "label": "Endpoint" },
          { "field": "Value", "label": "p95", "format": { "$fmt": "duration", "unit": "s" }, "align": "right" }
        ],
        "sort": { "field": "Value", "dir": "desc" }
      }
    }
  ]
}
```

Note how the chart's `series` entry has no data. The adapter expands it into one series per frame
(per service label) from `datasets[0]`, and the model never needs to know how many series will
come back.

## Diffing

`dashboards/diff(a, b)` compares specs structurally:

- panels are matched by `id`, then classified `added`, `removed`, `changed` or `same`;
- `changed` panels carry field-level changes (`queries[0].expr`, `view.option.yAxis…`) rendered as
  the red/green lines on the diff card, with PromQL/SQL diffed line-wise;
- the variant plan is the same diff against the parent's pinned spec.
