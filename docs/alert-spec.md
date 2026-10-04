# Alert spec, v1

An alert spec says what to watch, when it fires and what its notifications say. It is plain JSON,
like the [dashboard spec](dashboard-spec.md), and lives in `packages/shared/src/spec/alert.ts` as a
Zod schema. The server evaluates it with no model involved.

The principles are the dashboard spec's:

1. **JSON only.** No functions, no code strings, no HTML.
2. **Queries are templates.** The query is a panel query, so a query builder, a saved query and a
   raw query all give one. Variables are bound, never pasted into the query.
3. **Versioned.** `specVersion` allows migrations later.

## Types (TypeScript sketch)

```ts
type AlertSpec = {
  specVersion: 1
  title: string
  description?: string
  query: PanelQuery                         // as in a dashboard panel, with its refId
  value: {
    field?: string                          // the number column compared; the first one by default
    reduce: 'last' | 'max' | 'min' | 'mean' | 'sum'   // the points of the window to one value; 'last'
    by?: string[]                           // the columns that tell series apart, for rows
    maxSeries: number                       // 1..1000, 100 by default
    format?: NamedFormatter                 // how the value reads in a notification
  }
  variables: { name: string; value: string | string[]; interval?: boolean }[]
  condition:
    | { kind: 'threshold'; op: 'above' | 'below'; value: number; for: Duration }
    | { kind: 'no_data'; for: Duration }
  every: Duration                           // how often it is evaluated; 1m or more
  lookback: Duration                        // the window each evaluation queries; 1m to 7d, ≥ for
  severity: 'critical' | 'warning' | 'info'
  channels: string[]                        // notification channel ids
  notify: { onResolved: boolean; repeatEvery?: Duration }   // onResolved: true by default
  message: MessageTemplate                  // title, body and fields with {placeholders}
  timezone?: string                         // IANA, for times in notifications; UTC by default
}

type Duration = string                      // digits and s, m, h or d: '30s', '5m', '1h', '2d'
```

## Series

Each evaluation turns the query's result into series:

- A time series frame (Prometheus, Loki) is one series; its labels are the value field's labels.
- Rows (SQL and the other row results) form one series per value of the label columns: every text
  column by default, or the columns in `value.by`. The value field's labels are added.
- A series' key is its labels in order, such as `{code="500", service="checkout"}`.
- Past `maxSeries`, the series are dropped in order of their keys, and the result says so.
- The points of a series within the window become one value with `reduce`; `last` takes the point
  with the latest time.

## Variables

An alert has no viewer to pick a value, so each variable the query uses has a fixed value. A list
binds like a multi-value dashboard variable. `interval: true` marks a duration that goes where a
duration goes, such as `[$window]` in PromQL, and the value must then be a duration.

## Conditions

- `threshold`: a series' value is strictly above or below `value`. It fires once it has held for
  `for`; `0m` fires at once.
- `no_data`: the query returns no value at all. It is evaluated on the alert as a whole and fires
  once that has lasted `for`.

## The message

`message` is the shared message template: a title (up to 150 characters), a body (up to 1000) and
up to 8 labelled fields. They use only these placeholders: `{alert}`, `{series}`, `{value}`,
`{threshold}`, `{duration}`, `{since}`, `{severity}` and `{link}`. An unknown placeholder fails
validation. Each channel fills and escapes the values for its service, so text from the data never
becomes markup.

The server fills the values from the series:

| Placeholder   | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| `{alert}`     | the title                                                    |
| `{series}`    | the labels as `name=value, …`, or `all` without labels       |
| `{value}`     | the value, with `value.format` or four significant digits    |
| `{threshold}` | such as `above 5%`, or `no data`                             |
| `{duration}`  | the condition's `for`                                        |
| `{since}`     | when the series entered its state, in `timezone`             |
| `{severity}`  | the severity                                                 |
| `{link}`      | the alert's page, `/alerts/<id>` under quanthea's public URL |

## Validation beyond the schema

The schema catches shape errors and checks across fields: `every` is at least a minute, `lookback`
covers the condition's `for`, `repeatEvery` is no shorter than `every`, a variable is named once and
an interval variable holds a duration. `alerts/validate.ts` (`validateAlertSpec`) also checks:

- the connector exists and runs the query's language;
- the query binds with the fixed variables exactly as it will at run time: a variable without a
  value, a misplaced variable, or a SQL template that is not one read statement is reported;
- the window fits the connector's `maxRangeDays`;
- the time zone is known.

Issues come back with paths (`{ path: 'query.expr', message: … }`). `checkAlert` (`alerts/check.ts`)
validates, then runs the query once over the window ending now and reads it as the evaluator
would, for the caller that writes a version.

## Example

```json
{
  "specVersion": 1,
  "title": "Checkout 5xx rate",
  "query": {
    "refId": "A",
    "connector": "prometheus-prod",
    "language": "promql",
    "expr": "sum by (service) (rate(http_requests_total{env=\"$env\",code=~\"5..\"}[1m])) / sum by (service) (rate(http_requests_total{env=\"$env\"}[1m]))"
  },
  "value": { "format": { "$fmt": "percent", "decimals": 1 } },
  "variables": [{ "name": "env", "value": "prod" }],
  "condition": { "kind": "threshold", "op": "above", "value": 0.02, "for": "5m" },
  "every": "1m",
  "lookback": "10m",
  "severity": "critical",
  "channels": ["oncall-checkout"],
  "notify": { "onResolved": true, "repeatEvery": "1h" },
  "message": {
    "title": "{alert}: {series} at {value}",
    "body": "The 5xx share is {threshold} for {duration}, since {since}. {link}"
  }
}
```
