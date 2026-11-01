# Queries and charts

The agent rarely writes a query. It names the data it wants, and quanthea writes and tests the
query from a **query builder** or a **saved query**. That costs fewer tokens and breaks fewer
panels. Admins choose the builders, write saved queries, and choose the charts the agent may draw.

## Settings → Queries

![Settings → Queries: the query builders, each with an example, the query it becomes and a preview](../screenshots/settings-queries-light.webp#gh-light-mode-only)
![Settings → Queries: the query builders, each with an example, the query it becomes and a preview](../screenshots/settings-queries-dark.webp#gh-dark-mode-only)

### Query builders

quanthea ships builders for each query language: rates, ratios (such as 5xx over all requests),
latency percentiles and top N for PromQL; series over time, breakdowns, single numbers and rows
for SQL; the same for search, LogQL and MongoDB. Each writes a query for its source's dialect, with
names checked and quoted and variables bound.

For search there is also a table builder. It groups by one to three fields and gives up to
eight named columns: a count, a metric or a percentile, each with its own filters, or the ratio of
two of them. For example: by browser and version, the starts, the errors, and the errors per start.
It sorts by any column and keeps up to 500 rows. When it sorts by a ratio, the rows kept are the
500 with the most documents, sorted by the ratio.

A search table can split by named groups instead of a field: each group has a name
and its own filters, such as "Coast" for two business units and "Inland" for two others.

A search breakdown or table can end with an "Other" row: the documents outside the values kept.
It is a count, so a breakdown of a sum or a distinct count has none. A donut draws it last, in a
neutral colour.

A filter compares a field with a value (`=`, `!=`), or matches it against a regular expression
(`=~`, `!~`). The search builders, for Elasticsearch and OpenSearch, take more:

- A bound: `>`, `>=`, `<`, `<=`, on a number or a date.
- A list: `in`, with the values written out or a variable that holds several.
- A field that has a value: `exists`.
- A wildcard: `like`, with `*` for any text and `?` for one character.
- Alternatives: filters that carry the same name in `any`, of which one must hold.

A bound can be a computed variable, read by the server before the panel runs. To cut a histogram
of load times at the 95th percentile, ask for "a histogram of load times up to the p95": the
dashboard gets a hidden variable that reads the percentile, and the histogram keeps the values
at or below it.

A wildcard pattern starts with text, such as `urn:srf:*`, and holds four wildcards at most. A
pattern that starts with a wildcard reads every value of the field, so the builders refuse it.
To search by the end or the middle of a value, ask for a text variable: the pattern is then
yours to type. A variable is the whole pattern or the whole bound, never a part of it.

A variable that holds several values goes with `=`, `!=` or `in`. In a pattern or a bound it is
refused when the dashboard is saved, with a message that says so.

Sessions and events are counted two ways. A count of the event that starts a session gives the
sessions started in the range. A distinct count of the session id gives every session seen,
including those started before it. The agent uses the one you ask for, and the panel's
description says which.

Each builder shows its fields, an example, the query it becomes, and what it returns. **Try it**
runs the example on a connector and time range you choose, and draws it. Nothing is saved, and no
model runs.

Switch a builder off, and the agent stops using it.

### Saved queries

A saved query is your own query, in any language, with placeholders such as `{{service}}`. Each
placeholder has a type: a metric, a label, a table, a column, a value or a duration. Give the query
an id, one sentence that says what it returns, and the shape of its result. The agent asks for it by
id with a value for each placeholder, and quanthea checks and quotes each value before it runs.

Use them for the numbers your team defines one way: "active customers", "revenue net of refunds".
Run a saved query on a connector before you keep it.

### Which queries a thread uses

When an editor starts a thread, they choose:

- **Default queries**: the builders switched on, and every saved query.
- **Choose queries…**: some of them.
- **Free style**: raw queries only.

## Settings → Charts

![Settings → Charts: every chart recipe drawn from its own sample, each with its switch](../screenshots/settings-charts-light.webp#gh-light-mode-only)
![Settings → Charts: every chart recipe drawn from its own sample, each with its switch](../screenshots/settings-charts-dark.webp#gh-dark-mode-only)

The agent draws with **chart recipes**: about thirty of them, for trends, comparisons,
distributions, composition, relationships, flows, maps, numbers, tables and small multiples. The
page draws each recipe and its variants from a sample. Switch one off, and the agent no longer
offers it; at least one stays on.

Charts never run code from the model: a recipe is a fixed template, and values are formatted with
named formatters only.

## In the configuration file

`queries` switches builders off and declares saved queries; `charts` switches recipes off. See
[the configuration file](../configuration.md#queries-and-charts).
