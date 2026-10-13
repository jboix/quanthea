# Alert spec, v1

An alert spec says what to watch, when it fires and what its notifications say. It is plain JSON,
like the [dashboard spec](dashboard-spec.md), and lives in `packages/shared/src/spec/alert.ts`,
`alert-condition.ts` and `alert-ratio.ts` as a Zod schema. The server evaluates it with no model involved.

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
  dividedBy?: {                             // a second query: the value is then a ratio
    query: PanelQuery                       // on the same connector or another
    field?: string                          // the number column divided by; the first one by default
    by?: string[]                           // the columns that tell its series apart, for rows
    whenZero: 'zero' | 'no_value'           // what a division by 0 reads; 'zero'
  }
  value: {
    field?: string                          // the number column compared; the first one by default
    reduce: 'last' | 'max' | 'min' | 'mean' | 'sum'   // the points of the window to one value; 'last'
    by?: string[]                           // the columns that tell series apart, for rows
    maxSeries: number                       // 1..1000, 100 by default
    format?: NamedFormatter                 // how the value reads in a notification
  }
  variables: { name: string; value: string | string[]; interval?: boolean }[]
  condition: (Threshold | Change | Past | Band) & { for: Duration }
    | { kind: 'all' | 'any'; of: Part[]; for: Duration }   // 2 to 4 parts, never nested
    | { kind: 'no_data'; for: Duration }
  every: Duration                           // how often it is evaluated; 1m or more
  lookback: Duration                        // the window each evaluation queries; 1m to 7d, ≥ for,
                                            // and longer than a change's `within`
  severity: 'critical' | 'warning' | 'info'
  channels: string[]                        // notification channel ids
  notify: { onResolved: boolean; repeatEvery?: Duration }   // onResolved: true by default
  message: MessageTemplate                  // title, body and fields with {placeholders}
  timezone?: string                         // IANA, for times in notifications; UTC by default
  quietHours?: QuietHours | 'none'          // when it sends nothing; the settings' default if left out
}

type Reducer = 'last' | 'max' | 'min' | 'mean' | 'sum'
type Threshold = { kind: 'threshold'; op: 'above' | 'below'; value: number }
type Change = {
  kind: 'change'
  direction: 'up' | 'down'
  amount: number                            // above 0: at least this much
  unit: 'percent' | 'absolute'              // a share of the earlier point, or a difference
  within: Duration                          // how far back the earlier point is
}
type Past = {
  kind: 'past'
  direction: 'up' | 'down'                  // above or below the value then
  amount: number                            // above 0: at least this much
  unit: 'percent' | 'absolute'              // a share of the value then, or a difference
  ago: '1h' | '1d' | '7d'                   // how far back the window it compares with is
}
type Band = {
  kind: 'band'
  side: 'above' | 'below' | 'either'        // which side of the band fires
  deviations: number                        // 0.5 to 10: the band's reach each side of the mean
  baseline: Duration                        // 1h to 7d: the history before the window
}
type Part =                                 // a test of a joined condition, without `for`
  | (Threshold | Past | Band) & { field?: string; reduce?: Reducer; format?: NamedFormatter }
  | Change & { field?: string; format?: NamedFormatter }

type QuietHours = {
  timezone: string                          // IANA, the clock of the windows
  windows: {                                // 1 to 8; quiet while any of them holds
    days: Weekday[]                         // 'monday' … 'sunday': the days the window starts on
    from: string                            // 'HH:MM'
    to: string                              // 'HH:MM'; at or before `from`, it ends the next day
  }[]
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

## The interval of the query

A query that cuts time into buckets takes their width from the interval built-in of its language:
`:__interval` in SQL (or `:__interval_s`, the same in seconds), `{"$var": "__interval"}` in a
search, `{"$var": "__interval_ms"}` in MongoDB.

- The alert binds one interval to it, from a closed list, by its `lookback`: `1m` up to 2 hours,
  `5m` up to 12 hours, `10m` up to 36 hours, `30m` up to 4 days, then `1h`.
- Every read binds the same one: each evaluation, the history of a `past` or a `band`, and a
  replay over a week. A bucket is as wide in a replay as in a check.
- A PromQL or LogQL query takes none. An evaluation reads it at its instant, and a replay as a
  range query at `every`.
- `every` says how often the alert is checked. The interval says how wide a bucket of the query
  is. Neither follows the other.

## The ratio of two queries

An alert may name a second query in `dividedBy`. Its value is then the first query's value divided
by the second's, and the condition compares that ratio. There is no formula: the division is the
one thing `dividedBy` does.

Use it when one query cannot divide: the two sides are on two connectors, or in two tables or
indices one query cannot join. When one query can divide, let it. That is one query per check, not
two.

- **Both sides are read the same way.** The points of each side within the window become one value
  with `value.reduce`, then the first is divided by the second. `sum` over `sum` suits counts,
  `last` over `last` gauges. The alert's variables bind in both queries.
- **Series match by their labels.** Two series match when every label both carry has the same
  value. A label only one side carries is not compared. So a total per service divides each status
  code of that service, and a total with no labels divides every series.
- **A series needs exactly one match.** A series of the first query that matches no series of the
  second, or more than one, has no value: it is missing, as a series the result left out. It does
  not start firing, and a series that fired resolves after the grace period, not at once. More
  than one means the second query tells apart what the first does not, so no one series is its
  total.
- **A second query that returns nothing** while the first returns series cannot be divided by at
  all: the alert cannot be checked, and says so as for a failed query.
- **The series are the first query's.** A series only the second query returns is not a series of
  the alert. A series the first query stops returning goes missing, as for any alert: it is not
  read as 0.
- **A division by 0** reads 0 with `whenZero: 'zero'`, the default, whatever is divided: there is
  nothing to take a share of. With `no_value` it has no value and never holds. Use `no_value` for
  a condition that fires below a number, such as a success share under 99%: with `zero`, every
  moment without traffic reads 0 and fires.
- **What compares a ratio.** A `threshold`, or a `change`, which divides the latest points of both
  sides and the earlier points of both sides. In `all` and `any`, a part without a `field` reads
  the ratio, and a part with one reads that column of the first query, undivided: "error share
  above 5% with at least 100 errors". A `past` or a `band` that reads the ratio is refused: it
  would read the history of both queries. So is `no_data`, which watches one query.
- **The cost.** The second query runs at every evaluation, after the first, over the same window,
  through the query engine with its own connector's guardrails, timeout, row limit and visibility.
  It counts as one query towards the cap of active alerts of the connector it runs on. An
  evaluation whose second query fails cannot be checked.

## Variables

An alert has no viewer to pick a value, so each variable the query uses has a fixed value. A list
binds like a multi-value dashboard variable. `interval: true` marks a duration that goes where a
duration goes, such as `[$window]` in PromQL, and the value must then be a duration.

## Conditions

The set of conditions is closed: each is a named `kind`, plain JSON, with no expression and no
formula text. The agent writes one through its tool and a person changes its values in the
condition sentence. Every kind has a `for`: the series fires once the condition has held that long,
and `0m` fires at once.

A condition is made of **tests**. A test reads one number field of a series and says whether it
holds. `threshold`, `change`, `past` and `band` are one test each, `all` and `any` join several,
and `no_data` has none.

- `threshold`: the series' value is strictly above or below `value`.
- `change`: the series rose or dropped by `amount` or more within `within`. It compares the latest
  point of the window with the latest point at least `within` before it, so both lie inside the
  `lookback`, which must be longer than `within`.
  - `unit: 'absolute'` compares the difference. `unit: 'percent'` compares it as a share of the
    earlier point, counted on its size, so a rise from a negative point is still a rise.
  - The words tell the two apart for a value that is itself a percentage: a difference reads
    `5 percentage points` in the sentence, the lists, `{threshold}` and `{change}`, and a share
    of the earlier point reads `5%`.
  - It does not hold while the window has no earlier point: a new series, too little history, an
    instant query, or a result without a time column.
  - In percent it does not hold when the earlier point is 0: a share of nothing is not a number.
    An absolute change does.
  - It reads the latest point whatever the reducer, so `value.reduce` must be `last`.
  - It stops holding once the earlier point has caught up with the new level, `within` after the
    move, though the value may stay there. An alert about the level itself is a threshold.
- `past`: the series' value is `amount` or more above (`up`) or below (`down`) its value `ago`
  earlier. The same query runs a second time over the window shifted back by `ago`, and the value
  of each series there, reduced as the alert's value is, is what it is compared with.
  - `ago` is one of an hour, a day and a week: the periods a level usually repeats over.
  - The shift is an exact length, 24 hours for `1d` and 168 for `7d`, whatever the alert's time
    zone. Across a daylight saving change the window then is an hour off on the local clock, for
    a day or a week after the change.
  - `unit` reads as for a change: a difference, or a share of the value then, counted on its size.
  - A series with no value then does not hold: a new series, or data that does not go back that
    far. It is watched, and compared once it is old enough.
  - In percent it does not hold when the value then is 0. An absolute comparison does.
  - A series that was there then and is gone now is not a series of the alert.
  - Any reducer fits: with `mean` and a `lookback` of an hour, it is this hour against that hour.
- `band`: the series' value lies outside the band its own history gives. The same query runs a
  second time over the `baseline` that ends where the window starts, as a range query for PromQL
  and LogQL. The band is the mean of the series' points there, give or take `deviations` times
  their standard deviation (the population's).
  - `side` says where it fires: `above` the band, `below` it, or `either`.
  - The value must be strictly outside. On the edge it does not hold.
  - Too little history gives no verdict, and it does not hold: fewer than 10 points with their
    times in the baseline, or points that span less than half of it.
  - A baseline that never moved has a deviation of 0: the band is its one value, and any other
    value is outside. Join the band with a threshold to ignore small numbers.
  - The baseline ends before the window, so the value never weighs on its own band.
  - The band is that of the single points of the baseline, so the value it judges is the `last`
    or the `mean` of the window. A `sum`, a `max` or a `min` is refused: it is on another scale
    than a single point, or sits on one side of the mean.
  - A PromQL or LogQL query names its durations itself. A built-in that follows the time range
    (`$__interval`, `$__rate_interval`, `$__range`) is refused: it takes another value over the
    baseline than over the window. The interval of a bucketed language is the alert's own, the
    same over the baseline: see [the interval of the query](#the-interval-of-the-query).
- `all` and `any`: two to four tests on the one query, in `of`. `all` holds when every test holds,
  `any` when at least one does. A part is a threshold, a change, a `past` or a `band` without
  `for`, and never a joined condition. At most one part is a `past` or a `band`.
  - The first part reads the alert's value: `value.field`, `value.reduce` and `value.format`. It
    names none of its own.
  - A later part may read another number field of the same result with `field`, reduce it with its
    own `reduce` (any part but a change), and write its numbers with its own `format`. What it leaves
    out is the alert's.
  - Series are told apart as for any alert, by `value.by` or the text columns, so the parts of a
    series are the fields of the same rows.
  - A part with no value for a series does not hold. `all` then cannot hold for that series, and
    `any` can through another part. A series is left out only when no part has a value for it.
  - A part that names a column the result does not have is a failed check, as a missing
    `value.field` is.
- `no_data`: the query returns no value at all. It is evaluated on the alert as a whole and fires
  once that has lasted `for`.

**The value a series reports** is the same for every kind: `value.field` reduced by
`value.reduce`, which is the first test's. It is what the list, the alert's page, the replay chart
and `{value}` show. A change reports the latest point, and a joined condition its first part.

**History costs a query.** A `past` and a `band` each run a second query at every evaluation,
after the alert's own and through the same query engine: the same guardrails, timeout, row limit
and connector visibility. That is why a condition has at most one of them.

- A `past` query covers a window as long as the alert's own. A `band` query covers the whole
  baseline, up to seven days: PromQL and LogQL answer it at a coarser step, a SQL query reads that
  many more rows.
- An evaluation whose history query fails cannot be checked, as when its own query fails.
- Such an alert counts as two towards the cap of active alerts per connector.
- Prefer `every` of `5m` or more, and the shortest baseline that holds the normal ups and downs.

## Quiet hours

During quiet hours the alert is evaluated and its changes of state are recorded, and no
notification is sent.

- `quietHours` left out: the default of the alert settings holds (`quietHours` there), unless the
  alert's severity is one of its `exceptSeverities`, `critical` by default.
- `quietHours: 'none'`: the alert always notifies.
- `quietHours` with windows: the alert's own, whatever its severity. The default no longer holds.
- A window with `from` and `to` the same lasts 24 hours from `from`.
- The clock is the wall clock of `timezone`. When daylight saving skips an hour, a window that
  ends inside it ends with the jump; an hour shown twice is quiet both times.
- When they end, a series still firing announces it, with the field `Firing since` (`{since}`)
  added when the message names `{since}` nowhere and has fewer than 8 fields. A resolution owed
  from before waits for the end too.

## The message

`message` is the shared message template: a title (up to 150 characters), a body (up to 1000) and
up to 8 labelled fields. They use only these placeholders: `{alert}`, `{series}`, `{value}`,
`{values}`, `{change}`, `{previous}`, `{band}`, `{numerator}`, `{denominator}`, `{threshold}`,
`{duration}`, `{since}`, `{severity}` and `{link}`. An unknown placeholder fails
validation. Each channel fills and escapes the values for its service, so text from the data never
becomes markup.

The server fills the values from the series:

| Placeholder     | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| `{alert}`       | the title                                                    |
| `{series}`      | the labels as `name=value, …`, or `all` without labels       |
| `{value}`       | the value, with `value.format` or four significant digits    |
| `{values}`      | the value of every test, such as `2.4%, requests 312`        |
| `{change}`      | how far a change or a `past` moved, such as `-52%` or `+230` |
| `{previous}`    | the earlier value it moved from                              |
| `{band}`        | the band of a `band`, such as `1.2% to 2.4%`                 |
| `{numerator}`   | for a ratio, the first query's value, such as `12`           |
| `{denominator}` | for a ratio, the second query's value, such as `480`         |
| `{threshold}`   | the condition, such as `above 5%` or `no data`               |
| `{duration}`    | the condition's `for`                                        |
| `{since}`       | when the series entered its state, in `timezone`             |
| `{severity}`    | the severity                                                 |
| `{link}`        | the alert's page, `/alerts/<id>` under quanthea's public URL |

- `{threshold}` reads after a subject: `down 50% or more within 10m` for a change, and
  `above 2% and requests above 100` for a joined condition, each later part named by its field.
- `{values}` names each later part by its field too, and leaves out a part without a value. For a
  condition of one test it is `{value}`.
- `{threshold}` reads `up 30% or more from a week earlier` for a `past`, and
  `more than 3 deviations from its mean of the last 1d` for a `band`.
- `{change}` and `{previous}` are about the first `change` or `past` of the condition. They are
  empty for a condition without one, when there was no earlier value, and for a series that is
  gone.
- `{band}` is about the first `band` of the condition. It is empty for a condition without one, and
  with too little history to learn a band.
- `{numerator}` and `{denominator}` are the two sides of a ratio, with four significant digits and
  never in `value.format`, which is the ratio's. They are empty for an alert without `dividedBy`,
  and for a series with no match in the second query.

## Validation beyond the schema

The schema catches shape errors and checks across fields: `every` is at least a minute, `lookback`
covers the condition's `for` and is longer than a change's `within`, `value.reduce` is `last` when
the alert's value is read by a change, the first part of a joined condition names no field, reducer
or format, a band's `baseline` is from `1h` to `7d` and its value is reduced by `last` or `mean`, a
change's `within` is above zero, at most one test is a `past` or a `band`, no
`past` or `band` reads a ratio and no `no_data` has a second query, `repeatEvery` is no shorter
than `every`, a variable is named once and an interval variable holds a duration; the time zone of
`quietHours` is known. `alerts/validate.ts` (`validateAlertSpec`) also checks:

- every channel id names a notification channel (on save and activation);
- the connector exists and runs the query's language;
- the query binds with the fixed variables exactly as it will at run time: a variable without a
  value, a misplaced variable, or a SQL template that is not one read statement is reported;
- the window fits the connector's `maxRangeDays`, and so does the baseline of a band;
- the PromQL or LogQL query of a band uses no built-in that follows the time range, at `query`;
- the second query of a ratio the same way, against its own connector, at `dividedBy.query`;
- the time zone is known.

Issues come back with paths (`{ path: 'query.expr', message: … }`). `checkAlert` (`alerts/check.ts`)
validates, then runs the query once over the window ending now and reads it as the evaluator
would, for the caller that writes a version. It refuses a change that no series of the result has
an earlier point for, at `condition.within`: the query is instant, has no time column, or the
window is too short, and the alert would never fire. It runs the history query of a `past` or a
`band` too, and refuses for the same reason a `past` no series has a value for then (at
`condition.ago`) and a `band` no series has enough history for (at `condition.baseline`). It says
nothing of history while the query returns no series at all. It runs the second query of a ratio
too, and refuses, at `dividedBy`, a second query none of whose series matches a series of the
first, and a `dividedBy.field` the result does not have.

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

Other conditions on the same alert:

```json
{ "kind": "change", "direction": "down", "amount": 50, "unit": "percent", "within": "10m", "for": "0m" }
```

```json
{
  "kind": "all",
  "of": [
    { "kind": "threshold", "op": "above", "value": 0.02 },
    { "kind": "threshold", "op": "above", "value": 100, "field": "requests", "format": { "$fmt": "number" } }
  ],
  "for": "5m"
}
```

```json
{ "kind": "past", "direction": "up", "amount": 30, "unit": "percent", "ago": "7d", "for": "10m" }
```

```json
{ "kind": "band", "side": "either", "deviations": 3, "baseline": "1d", "for": "5m" }
```
