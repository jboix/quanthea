# The configuration file

quanthea can be set up entirely from a file: the server settings, the users, sign-in, the data
sources, the model, retention, queries, charts and plugins. Keep it in Git and an instance can be
rebuilt from it. Everything the file leaves out stays editable in the interface.

The file is optional. Without one, an admin sets everything up in the interface.

## Where it goes

`QUANTHEA_CONFIG` names a YAML or JSON file, or a directory whose `*.yaml`, `*.yml` and `*.json`
files are read in name order. In the Docker image it is `/etc/quanthea`, empty until you mount a
file there:

```sh
docker run -d --name quanthea -p 3000:3000 \
  -v quanthea-data:/data \
  -v quanthea-keys:/keys \
  -v ./quanthea.yaml:/etc/quanthea/quanthea.yaml:ro \
  --env-file .env \
  ghcr.io/jboix/quanthea
```

Each top-level key is a section. A key is set in one file only, so a directory can split the
sections across files.

[`configuration.schema.json`](configuration.schema.json) describes every field. Start the file
with this line, and editors that read it complete and check the file as you type:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/jboix/quanthea/main/docs/configuration.schema.json
```

## Secrets and variables

A secret is never written in the file. Each password, client secret, API key and connector
credential is a whole reference:

- `"${NAME}"`: the environment variable `NAME`. Quote it inside `{ }`, where YAML would read it
  otherwise.
- `file:/run/secrets/name`: a file, such as a Docker or Kubernetes secret.

Any other text value may use `${NAME}` too, such as `host: ${DB_HOST}`. `$${` writes a literal
`${`. An unset variable stops the server, and no message ever quotes a secret.

## When it applies

- quanthea reads the file at startup. Restart it to apply a change, to the file or to a secret it
  refers to.
- A mistake applies nothing: the server stops and lists every issue.
- What the file declares is read-only in the interface, with a badge naming the file.
- Remove an item from the file and it stays, editable again. With `provisioning.prune: true`,
  quanthea deletes it instead (a user is disabled, a provider removed).

## server

The system settings. An environment variable wins over the file, and the file over the default.
**Settings → Server** shows each one and where it comes from.

```yaml
server:
  publicUrl: https://quanthea.example.com
  trustedProxyHops: 1
  logLevel: info
  logFormat: json
```

| Key                | Default       | What it sets                                                     |
| ------------------ | ------------- | ---------------------------------------------------------------- |
| `publicUrl`        | none          | The address people reach quanthea at. Sign-in providers need it. |
| `trustedProxyHops` | `0`           | Reverse proxies in front that add to `X-Forwarded-For`, up to 5. |
| `port`             | `3000`        | The HTTP port.                                                   |
| `dataDir`          | `./data`      | The SQLite database. `/data` in the image.                       |
| `keysDir`          | `./keys`      | The generated keys. `/keys` in the image.                        |
| `webDir`           | the built app | The web app the server serves.                                   |
| `logLevel`         | `info`        | `debug`, `info`, `warn` or `error`.                              |
| `logFormat`        | `text`        | `text` for readable lines, `json` for one object per line.       |

[Environment variables](environment.md) lists the variable for each.

## users

Users by email, or `admin`, who signs in as `admin` with no email.

```yaml
users:
  admin:
    password: ${ADMIN_PASSWORD}
  ana.keller@example.com:
    name: Ana Keller
    role: admin
  marco.rossi@example.com:
    name: Marco Rossi
    role: editor
    password: file:/run/secrets/marco
  tom.weber@example.com:
    role: viewer
    disabled: true
```

| Key        | Default  | What it sets                                                 |
| ---------- | -------- | ------------------------------------------------------------ |
| `name`     | none     | The name, set when the user is created.                      |
| `role`     | `viewer` | `viewer`, `analyst`, `editor` or `admin`.                    |
| `disabled` | `false`  | A disabled user signs nothing in.                            |
| `password` | none     | A secret reference. Set only while the user has no password. |

A user without a password signs in through a provider with that verified email. `admin` needs a
`password`, and stays an admin. With an admin declared, quanthea creates no `admin` user of its own.

## signIn

Password sign-in and the [sign-in providers](guide/users-and-sign-in.md#sign-in-providers), by id.

```yaml
signIn:
  passwordSignIn: true
  providers:
    google:
      kind: google
      name: Google
      join: { mode: domain, values: [example.com] }
      clientId: 1234.apps.googleusercontent.com
      clientSecret: ${GOOGLE_CLIENT_SECRET}
    entra:
      kind: entra
      name: Microsoft
      tenant: example.onmicrosoft.com
      clientId: 00000000-0000-0000-0000-000000000000
      clientSecret: ${ENTRA_CLIENT_SECRET}
```

| Key            | Default  | What it sets                                                           |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `kind`         | none     | `github`, `google`, `gitlab` or `entra`.                               |
| `name`         | none     | The name on the sign-in button.                                        |
| `baseUrl`      | `null`   | GitLab only: your own GitLab's address. `null` for gitlab.com.         |
| `tenant`       | `null`   | Entra ID only: the tenant's id or domain.                              |
| `join.mode`    | `invite` | Who may join: `invite`, `domain`, `organisation`, `group` or `tenant`. |
| `join.values`  | `[]`     | The domains, organisations or groups.                                  |
| `clientId`     | none     | The OAuth client id, in clear.                                         |
| `clientSecret` | none     | The OAuth client secret, as a secret reference.                        |
| `enabled`      | `true`   | A provider the file declares needs no test sign-in.                    |

`passwordSignIn: false` waits until an enabled admin can sign in through a provider; until then,
each start logs that it is deferred.

## connectors

The [data sources](guide/data-sources.md), by name. `config` holds the kind's settings in clear;
`secret` its credentials, as references.

```yaml
connectors:
  orders:
    kind: postgres
    config:
      host: db.example.com
      database: orders
      username: quanthea_ro
      tls: require
    secret:
      password: ${ORDERS_DB_PASSWORD}
    accessLevel: 3
    hiddenFields: [customers.email, customers.phone]
    guardrails: { timeoutMs: 15000, maxRows: 100000, maxRangeDays: 180 }
    descriptions:
      orders: One row per checkout attempt, paid or not.
  metrics:
    kind: prometheus
    config:
      url: http://prometheus:9090
```

| Key            | Default | What it sets                                                        |
| -------------- | ------- | ------------------------------------------------------------------- |
| `kind`         | none    | The connector kind, such as `postgres`, `prometheus` or a plugin's. |
| `config`       | none    | The connection, as the kind's form has it.                          |
| `secret`       | none    | The credentials, each a secret reference.                           |
| `accessLevel`  | `2`     | 1 schema only, 2 schema and metadata, 3 aggregates, 4 full access.  |
| `hiddenFields` | `[]`    | Columns the model never sees: `table.column`, or a bare `column`.   |
| `guardrails`   | below   | `timeoutMs` 10000, `maxRows` 50000, `maxRangeDays` 90.              |
| `descriptions` | `{}`    | Descriptions of tables and columns, read by the model.              |

`config` is stored in clear. A URL in it must not hold a username or a password, even from a
variable, and a host field must not hold `@`: put the username in the kind's `username` field and the password in `secret`.

A connector the file declares that already exists is taken over; its kind never changes. Its
descriptions stay editable in the interface unless the file declares them. The connection form of
each kind lists its `config` fields; the schema file has them too.

## model

The [model gateway](guide/models-and-usage.md), managed as a whole.

```yaml
model:
  defaultProviderId: anthropic
  providers:
    - id: anthropic
      name: Anthropic
      provider: anthropic
      baseUrl: null
      models:
        plan: claude-haiku-4-5
        build: claude-sonnet-5
        repair: ''
        metadata: claude-haiku-4-5
        answer: claude-sonnet-5
      apiKey: ${ANTHROPIC_API_KEY}
    - id: local
      name: Ollama
      provider: openai-compatible
      baseUrl: http://ollama:11434/v1
      models: { plan: '', build: qwen3-coder, repair: '', metadata: '', answer: '' }
      apiKey: ${OLLAMA_API_KEY}
  limits:
    threadTokens: 1000000
    toolCallsPerTurn: 25
    repairAttempts: 3
  behaviour:
    planApproval: true
    testRun: true
    shortReasoning: true
    planQueries: false
```

- `provider` is `anthropic`, `openai`, `mistral` or `openai-compatible`. `baseUrl` is `null` for
  a vendor's own API.
- Each job's model may be empty: it then uses the build model.
- `limits` and `behaviour` take their defaults when left out.

## retention

```yaml
retention:
  binDays: 30
```

How many days deleted threads and conversations stay in the [bin](guide/bin-and-retention.md),
30 by default; `null` keeps them until someone deletes them, and `0` purges at the next hourly run.

## queries and charts

The [query builders and saved queries](guide/queries-and-charts.md), and the chart recipes
switched off.

```yaml
queries:
  disabled: [sql-rows]
  saved:
    - id: active_customers
      name: Active customers
      description: Customers with a paid order in the range.
      language: sql
      query: |
        SELECT count(DISTINCT customer_id) AS value
        FROM orders
        WHERE status = 'paid' AND created_at BETWEEN :__from AND :__to
      shape: single
charts:
  disabled: [flow.sankey]
```

A saved query's `params` declares its placeholders, at most 10: each a `name` and a `kind`
(`metric`, `label`, `table`, `column`, `value` or `duration`), with an optional `description`.
`shape` says what it returns: `long`, `wide`, `single`, `values`, `matrix`, `hierarchical`,
`graph`, `geo`, `ohlc` or `rows`. **Settings → Queries** and **Settings → Charts** show the
builder and recipe ids.

## plugins

[Connector plugins](deployment.md#connector-plugins), read at startup.

```yaml
plugins:
  pins:
    "quanthea-plugin-sqlite": "sha256:f7eb…"
```

| Key             | Default              | What it sets                                          |
| --------------- | -------------------- | ----------------------------------------------------- |
| `dir`           | `<data dir>/plugins` | Where plugins are installed. `/plugins` in the image. |
| `pins`          | `{}`                 | The pin of each plugin, as the install prints it.     |
| `allowUnpinned` | `false`              | Load plugins without a pin.                           |

## provisioning

```yaml
provisioning:
  prune: false
```

With `prune: true`, what the file no longer declares is deleted instead of released: a connector
is deleted, a user disabled, a provider removed. A settings section keeps its values.

## What the file can't declare

Notification channels, alert and report settings, dashboards, alerts and reports live in the
interface. Their state is in the database, which you back up with the data volume.
