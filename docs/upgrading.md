# Upgrading

Pull the new image and restart. The database upgrades itself on the first start.

Most installations need to do nothing else. Each version below lists the setups that need an
action. If none applies to you, you are done.

## From 0.4 to 1.0

| Your setup                                                      | Step |
| --------------------------------------------------------------- | ---- |
| Connectors declared in `quanthea.yaml`                          | 1    |
| Elasticsearch or OpenSearch connectors declared in the file     | 1, 2 |
| Active alerts on Elasticsearch, OpenSearch or MongoDB           | 3    |
| SQL queries that call file, network or server functions         | 4    |
| HTTP connectors whose API redirects                             | 5    |
| Stats or tables over an Elasticsearch or OpenSearch time series | 6    |

### 1. Connectors in the file hide system objects

A connector declared in `quanthea.yaml` now hides the source's own system objects, and a query
on one is refused. Connectors made in the app are not affected.

| Source                    | Hidden                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Elasticsearch, OpenSearch | Indices that start with `.`, `security-auditlog-*`, `top_queries-*`, `ilm-history-*` |
| PostgreSQL, TimescaleDB   | `information_schema`, `pg_catalog`, `pg_*` and TimescaleDB's own schemas             |
| MySQL, MariaDB            | `information_schema`, `performance_schema`, `mysql`, `sys`                           |
| ClickHouse                | `system`, `information_schema`                                                       |
| Trino, InfluxDB           | `information_schema`, `system`                                                       |
| MongoDB                   | `system.` collections                                                                |

If a dashboard, alert or report reads one, add this to that connector and restart:

```yaml
connectors:
  warehouse:
    kind: postgres
    visibility:
      showSystem: true
```

A panel that reads a hidden object shows an error that names it. See
[`visibility`](configuration.md#connectors).

### 2. Elasticsearch and OpenSearch: one more permission

A connector that hides indices resolves index names before each search. Grant its credentials:

- Elasticsearch: the index privilege `view_index_metadata`.
- OpenSearch: the action `indices:admin/resolve/index`.

Or set `visibility.showSystem: true` on the connector: it then hides and resolves nothing.
Without either, every search on that connector fails with a permission error.

### 3. Alerts that use `__interval` on a search or MongoDB

An alert whose query names `__interval` (`__interval_ms` on MongoDB) is now checked on the same
buckets its replay chart shows:

| Lookback       | Bucket     |
| -------------- | ---------- |
| up to 2 hours  | 1 minute   |
| up to 12 hours | 5 minutes  |
| up to 36 hours | 10 minutes |
| up to 4 days   | 30 minutes |
| longer         | 1 hour     |

Before, a check used much finer buckets, so a count per bucket is now larger. Open each such
alert, look at its replay, and set its threshold again if it fires too often.

### 4. SQL functions that reach past the tables are refused

This applies to stored dashboards, alerts and reports too. A panel that calls one shows an error
that names the function. Rewrite the query without it.

| Source     | Refused, among others                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| PostgreSQL | `pg_read_file`, `lo_export`, `dblink`, `set_config`, `pg_notify`, `query_to_xml` |
| MySQL      | `LOAD_FILE`, `sys_exec`, `GET_LOCK`                                              |
| ClickHouse | `url`, `file`, `remote`, `s3`, `mysql`, `executable`                             |
| Trino      | `TABLE(catalog.system.query(...))`                                               |

### 5. HTTP connectors follow redirects only to allowed paths

If your API redirects to another path, add that path to the connector's allowed paths. A path,
or a variable value in a path, that holds a `..` segment is refused.

### 6. Search time series return their empty buckets

On Elasticsearch and OpenSearch, a time histogram now returns every bucket of the time range: 0
for a count, no value for an average. A stat or a table that takes a mean or a minimum over it
can show a different number. To keep the old number, add `"min_doc_count": 1` to the query's
`date_histogram` and save a new version. Alerts are not affected.

### After the upgrade

1. Run the connection test of each connector declared in the file.
2. Open one pinned dashboard per connector and check that its panels load.
3. A panel error that names an object: step 1. Every search failing with a permission error:
   step 2.
4. Look at the replay of each active alert on a search or MongoDB connector (step 3).
