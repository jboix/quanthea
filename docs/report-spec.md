# Report spec, v1

A report spec says which panels a report shows, when it runs, which period each run covers, what
it compares with, where it is sent and which numbers come first. It is plain JSON, like the
[dashboard spec](dashboard-spec.md) it builds on, and lives in `packages/shared/src/spec/report.ts`
as a Zod schema. The server runs it on schedule with no model involved.

The principles are the dashboard spec's:

1. **JSON only.** No functions, no code strings, no HTML, and no message template: our code writes
   every word of a report's message from the run's numbers.
2. **The panels are a dashboard's.** `panels`, `variables` and `annotations` are the dashboard
   spec's own schemas, checked by the dashboard's own validation. A report has no `time` and no
   `timezone` of its own: the period sets the range, and the schedule sets the clock.
3. **Versioned.** `specVersion` allows migrations later.

## Types (TypeScript sketch)

```ts
type ReportSpec = {
  specVersion: 1
  title: string
  description?: string
  variables: Variable[]                     // as in a dashboard; each run binds the defaults
  panels: Panel[]                           // as in a dashboard
  annotations?: Annotation[]                // as in a dashboard
  schedule: Schedule
  period: 'previous_day' | 'previous_week' | 'previous_month' | 'week_to_date'
  compare: 'previous_period' | 'none'       // 'previous_period' by default
  seeAlso: { dashboardId: string; label?: string }[]   // pinned dashboards, at most 5
  delivery: { channels: string[]; title?: string }     // notification channel ids, at most 20
  summaryPanels: string[]                   // stat panel ids, at most 8, in order
}

type Schedule =
  | { every: 'day'; at: 'HH:MM'; timezone: string }
  | { every: 'week'; weekday: 'monday' | … | 'sunday'; at: 'HH:MM'; timezone: string }
  | { every: 'month'; day: 1..31; at: 'HH:MM'; timezone: string }
```

## The schedule

A report runs at `at` on the clock of `timezone` (an IANA name such as `Europe/Zurich`), every
day, every week on `weekday`, or every month on `day`. A `day` past the month's end runs on its
last day: `31` runs on 30 September and on 28 or 29 February.

Daylight saving moves the instant, not the local time: "Mondays at 08:00" in Zurich is 06:00 UTC
in summer and 07:00 UTC in winter. A time the clock skips (02:30 on the day summer time starts)
runs once the clock jumps, at 03:30. A time the clock shows twice (02:30 on the day it ends) runs
once, the first time.

`nextRunAt(schedule, after)` and `latestRunAt(schedule, atOrBefore)` in
`packages/shared/src/reports/schedule.ts` compute the runs. They are pure, and the browser can use
them too.

## The period

Each run covers one period, resolved on the schedule's clock at the time the run is due:

| Period           | Covers                                                    | Named, for example                   |
| ---------------- | --------------------------------------------------------- | ------------------------------------ |
| `previous_day`   | yesterday, midnight to midnight                           | `Sat 4 Oct`                          |
| `previous_week`  | the previous ISO week, Monday to Sunday                   | `week 40, 29 Sep – 5 Oct`            |
| `previous_month` | the previous calendar month                               | `September 2026`                     |
| `week_to_date`   | this ISO week, from Monday's midnight to the time it runs | `week 41 so far, to Fri 9 Oct 17:00` |

A period runs from its first millisecond to the last millisecond before the next period starts, so
a query that keeps both ends (`BETWEEN :__from AND :__to`) never counts a row in two runs. Weeks
are ISO weeks: week 1 is the week of the year's first Thursday, so the week of 29 December 2025 is
week 1 of 2026. A day lasts 23 or 25 hours when the clock changes.

The panels run over the period as their time range: `$__from` and `$__to` (`:__from` and `:__to`
in SQL) are its ends.

## The comparison

With `compare: 'previous_period'`, each run also runs every panel over the period before: the day,
week or month before, or for `week_to_date` the same days and hours of the week before. A stat
panel among the `summaryPanels` then shows its change:

- a percentage (a `percent` format) changes in points: `▼ 0.4 pt`;
- any other number changes by a share of the number before, to one decimal: `▲ 6.2%`;
- a number that did not move reads `no change`;
- there is no change from zero, or without a number before.

## Headline numbers

`summaryPanels` names the stat panels whose numbers come first: in the reports list, at the top of
a run, and in the message sent. Each is read as the stat panel reads it (`reduce`, `field`,
`format`), so the message shows what the panel shows. Only stat panels can be headlines, and each
is named once.

## Links

`seeAlso` names pinned dashboards, each once. A run links to each, opened on the run's period,
with the `label` or else the dashboard's title. A dashboard unpinned since is left out.

## Delivery

`delivery.channels` names notification channels, as an alert's `channels` does. When a run
succeeds, each channel gets `report.ready`: the title (`delivery.title`, else the report's title)
with the period, such as `Weekly sales · week 40, 29 Sep – 5 Oct`, the headline numbers with their
change, a link to the run and the links to the dashboards. When a run fails after its retries,
each channel gets `report.failed` with the reason. Our code writes both; each channel's recipe
escapes the titles, the numbers and the reason as values.

## Example

```json
{
  "specVersion": 1,
  "title": "Weekly sales",
  "schedule": { "every": "week", "weekday": "monday", "at": "08:00", "timezone": "Europe/Zurich" },
  "period": "previous_week",
  "compare": "previous_period",
  "panels": [
    {
      "id": "revenue",
      "title": "Revenue",
      "grid": { "x": 0, "y": 0, "w": 3, "h": 3 },
      "queries": [
        { "refId": "A", "connector": "postgres-orders", "language": "sql",
          "sql": "SELECT sum(total) AS revenue FROM orders WHERE status = 'paid' AND created_at BETWEEN :__from AND :__to" }
      ],
      "view": { "kind": "stat", "ref": "A", "reduce": "last",
                "format": { "$fmt": "currency", "code": "CHF", "decimals": 0 } }
    },
    {
      "id": "orders",
      "title": "Orders",
      "grid": { "x": 3, "y": 0, "w": 3, "h": 3 },
      "queries": [
        { "refId": "A", "connector": "postgres-orders", "language": "sql",
          "sql": "SELECT count(*) AS orders FROM orders WHERE status = 'paid' AND created_at BETWEEN :__from AND :__to" }
      ],
      "view": { "kind": "stat", "ref": "A", "reduce": "last", "format": { "$fmt": "number", "decimals": 0 } }
    }
  ],
  "summaryPanels": ["revenue", "orders"],
  "seeAlso": [{ "dashboardId": "01JQ8…", "label": "Sales overview" }],
  "delivery": { "channels": ["01JQ9…"] }
}
```
