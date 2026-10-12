# Data sources

A connector is one data source quanthea reads: a PostgreSQL database, a Prometheus server, a Loki
instance, an HTTP API. Admins add and tune them in **Connectors**. Each connector says how much of
its data the model may see, which columns it never sees, and how far a query may go.

![Connectors: each source with its kind, where it points, its access level and its health](../screenshots/connectors-light.webp#gh-light-mode-only)
![Connectors: each source with its kind, where it points, its access level and its health](../screenshots/connectors-dark.webp#gh-dark-mode-only)

## Add a connector

1. **Connectors → Add a connector**, and pick the kind. Plugins add more kinds; see
   [Connectors and plugins](../connectors.md).
2. Name it: lowercase letters, digits and dashes. Dashboards refer to the connector by this name.
3. Fill in the connection. The credentials are sealed with quanthea's secret key and never shown
   again. A URL or a host must not hold a username or password: use the authentication fields.
4. **Save connection**. quanthea tests it and reads the schema.

Give quanthea a read-only account. Queries always run read-only, and each kind refuses what isn't
a read (writes in SQL, scripts in a search, JavaScript in MongoDB, write commands in Valkey), but a
role with read grants only is the hard guarantee. quanthea warns when a connection can write.

### TimescaleDB

TimescaleDB is a PostgreSQL extension, so quanthea reads it with the **PostgreSQL** connector: its
tile says "and TimescaleDB", and searching for "timescale" finds it.

- The connection test names the extension's version, such as "PostgreSQL 18.1 with TimescaleDB
  2.30".
- The schema lists hypertables, each with its time column and estimated row count, and continuous
  aggregates, each with the hypertable it summarises. Row counts come from TimescaleDB's chunk
  statistics, not from reading the data.
- The agent buckets time with `time_bucket` and fills empty buckets with `time_bucket_gapfill`. Over
  a long range it reads a continuous aggregate rather than its hypertable, since it is already
  bucketed.

## Access levels

The access level decides what the model sees of the source while it builds, answers and explains.
It never limits what a dashboard shows: panels run their saved queries with no model.

| Level             | The model sees                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| Schema only       | Tables, columns, types. Nothing else.                                      |
| Schema + metadata | Also row counts, the values of small columns, and the shape of a test run. |
| Aggregates        | Also summaries of results: min, max, spikes, top values, and when.         |
| Full access       | Also result rows, capped at the row limit.                                 |

**Schema + metadata** is the default. It is enough to build dashboards. **Ask about this** reads
numbers only from sources at **Aggregates** or **Full access**; below that, answers can only
explain. Alert replays in a conversation need Aggregates too.

Each thread shows the access of its sources under the question box.

## A connector's page

![A connector: its access level, hidden columns, guardrails, and the schema the model sees](../screenshots/connector-light.webp#gh-light-mode-only)
![A connector: its access level, hidden columns, guardrails, and the schema the model sees](../screenshots/connector-dark.webp#gh-dark-mode-only)

### Hidden columns

**Hide these columns from the model, by name**: list columns such as `customers.email`, or a bare
name such as `phone`. They are removed from the schema and from every result before the model sees
it. Names match in any case. A hidden object, such as `logs.user`, hides every field under it.
A field that holds a hidden one is removed whole: hiding `logs.user.email` also removes a `user`
column that holds an array of user objects, and the schema marks `user` as holding a hidden field.
A column that ends with a hidden name, such as `c.email`, is removed too.

**Add column** suggests the columns of the schema while you type. A name the schema does not have
is marked **not in the schema** and still hidden: the column may come later, or only in a query's
result.

A query that renames a column gets past the name: its top values show at the aggregates level, its
rows at full access. For data that must never leave, use a database role or a view that cannot
read it.

### Restricting access later

Lowering the access level or hiding a column applies to new tool calls. Data the model already
read stays in its threads, and continuing a thread sends its conversation, that data included, to
the model provider again.

Before such a change is saved, the page counts the threads that hold data it restricts and asks
you to confirm. If the count fails, the page says why and still lets you save or cancel. Those
threads are then marked **Restricted data** in the past threads list, and each shows a notice
above the question box. Start a new thread to leave that data out.

The count and the mark follow the model's tool calls. The model also gets a short list of field
values with each question, read at the access in force then. An earlier answer that quoted one of
those values, with no tool call, is not counted or marked.

### What a connector shows

A connector shows the model, and lets queries read, what the source's credentials can read, with
two limits you set. They are in the [configuration file](../configuration.md#connectors) and the
API, as `visibility`.

- **System objects are hidden.** They are the source's own: on Elasticsearch and OpenSearch the
  indices whose name starts with a dot and the security audit, query insight and lifecycle history
  indices; on a SQL source `information_schema` and the server's catalogs (`pg_catalog`,
  `performance_schema`, `mysql`, `sys`, `system`); on MongoDB the `system.` collections. Set
  `showSystem` to show them.
- **A list of names.** With `mode: except` the names are hidden; with `mode: only` nothing else is
  shown. A name is one the schema lists, or a pattern such as `logs-*`, where `*` stands for any
  text. Names match in any case.

A hidden object is left out of what the model reads, and every query on it is refused with a
message that names it: a panel, a variable, a marker, a saved query, an alert, a report and a
question in **Ask about this**. A dashboard that names one cannot be saved. A pinned dashboard that
reads an object you hide later shows the refusal on its panels.

How sure the refusal is depends on the source:

| Source                    | What is checked                                           | How sure                                                                                                            |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Elasticsearch, OpenSearch | The server resolves the index names and patterns first.   | Exact: `*` reaches only what is shown, aliases and data streams included.                                           |
| MongoDB                   | The collection, and the ones a pipeline joins or appends. | Exact for collections. A view reads what its definition says.                                                       |
| Redis, Valkey             | The key a command reads.                                  | Exact.                                                                                                              |
| HTTP                      | The method and path of the request.                       | Exact for the request. `{id}` in a name stands for any text, so the allowed paths of the connection stay the limit. |
| Prometheus                | The metric names of the expression.                       | Exact. A selector that names no metric is refused once you list names.                                              |
| Loki                      | The one object, `logs`.                                   | All or nothing. Restrict streams with the credentials.                                                              |
| SQL sources               | The table names after `FROM` and `JOIN`.                  | Best effort: a view, a function or the search path can reach a table the query never names.                         |

For SQL, treat the list as a way to keep the model on the right tables, not as a lock. For data
that must never leave, use a database role that cannot read it.

On Elasticsearch and OpenSearch the credentials must be allowed to resolve index names
(`view_index_metadata`, or `indices:admin/resolve/index`). Searches fail with the server's refusal
otherwise.

A SQL or MongoDB schema never lists system objects. `showSystem` lets queries read them there.

### Guardrails

| Guardrail               | Default | What it does                          |
| ----------------------- | ------- | ------------------------------------- |
| Query timeout (seconds) | 10      | A query stops after this long.        |
| Max rows per query      | 50,000  | A result is cut at this many rows.    |
| Max time range (days)   | 90      | A panel can't ask for a longer range. |

They apply to everything that runs a query: panels, alerts, report runs, snapshots and the model.
The page lists them under **Limits you set**. The access level is the other setting that bounds
what a query gives.

### Always enforced

Under the limits, the page lists the rules of the connector's query language. They are rules, not
settings: turning one off would run text a model wrote on the data source.

| Query language                     | What is always refused                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL                                | A second statement. A statement that does not start with `SELECT`, `WITH`, `VALUES` or `TABLE`, or that holds a keyword that writes or changes the schema. A value as SQL text: variables are parameters.                                          |
| PromQL                             | Anything but an expression sent to the query endpoints. A variable outside a quoted label matcher value, except an interval where a duration goes.                                                                                                 |
| LogQL                              | Anything but an expression sent to the query endpoints. A variable outside a quoted value, except an interval where a duration goes. The formatting templates `line_format` and `label_format`, which the source runs.                             |
| Search (Elasticsearch, OpenSearch) | Scripts, except the two fixed ratio scripts of a `bucket_script`. Runtime fields. Lookups of another index: a terms lookup, an indexed shape, a percolator, a document list that names an `_index`. Wrapper queries. Remote indices and `_` names. |
| HTTP                               | Another origin, a redirect to one, and cloud metadata addresses. A method or a path the connection does not allow. A path with a `.` or `..` segment, `?`, `#` or a backslash. A variable in a header.                                             |
| Redis (Valkey)                     | Any command outside the fixed list of reads: nothing writes, scans every key or runs a script.                                                                                                                                                     |
| MongoDB                            | `$out` and `$merge`. JavaScript: `$where`, `$function`, `$accumulator`. Stages that wait for changes or read the server's operations, sessions, queries, plans, catalog or statistics. Another database.                                           |

### The schema and descriptions

The page lists the tables or metrics the model sees, as it sees them at this level. Write a
description for a table or a column when its name doesn't say enough: the model reads yours in
place of the source's.

## Health

The list shows each connector's last test. A failing source shows on its panels as a safe error,
and alerts on it say they cannot be checked.

## In the configuration file

Connectors can be declared in the configuration file, with their credentials as references to
environment variables or files. Their settings are then read-only here; descriptions stay editable
unless the file declares them. See [the configuration file](../configuration.md#connectors).
