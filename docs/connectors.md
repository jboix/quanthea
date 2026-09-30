# Writing a connector

A **connector kind** teaches querent to read one kind of source, such as PostgreSQL. This guide
adds one. A kind is a folder in `apps/server/src/connectors/` and one line in the registry. It ships
no UI and no routes.

Kinds are compiled into the server today. Each kind already talks to the core only through the
connector kit, `connectors/_shared/index.ts`, so the same folder can later be loaded as a plugin.

## Who does what

| The core                                                  | The kind                                    |
| --------------------------------------------------------- | ------------------------------------------- |
| Builds the add and edit forms from the kind's schemas     | Declares its settings as two Zod schemas    |
| Encrypts the credentials and never returns them           | Opens a connection with the parsed settings |
| Binds dashboard variables into the query, safely          | Runs a bound query and returns frames       |
| Enforces the timeout, row limit and longest time range    | Honours the abort signal and the row limit  |
| Decides what the model sees (access level, hidden fields) | Reports the schema, without values          |
| Caches results, logs, audits, and serves the API          | Throws `ConnectorError` with a safe message |

A kind never receives a query template or a raw variable value. It never decides what the model
may see.

## 1. Pick the query language

A kind declares `language: 'sql'` or `language: 'promql'`. The core binds variables for that
language:

- `sql`: the kind also declares its `dialect`, `postgres`, `mysql` or `clickhouse`. It receives
  `SqlQuery`, one read statement with the dialect's placeholders (`$1`, `?` or `{p1:String}`) and
  their values. Bind them as driver or protocol parameters, never by concatenation. A new dialect needs its literals and placeholders in
  `apps/server/src/query/sql-dialects.ts` first.
- `promql`: the kind receives `PromqlQuery`, an expression with every variable escaped, plus
  `instant` and `stepSeconds`.

A source with another language needs a binder in `apps/server/src/query/` first. Open an issue
before starting one.

## 2. Declare the kind

Create `apps/server/src/connectors/<kind>/<kind>-connector.ts`:

```ts
import { z } from 'zod';
import { type ConnectorInstance, defineConnector } from '../_shared/index.ts';

const configSchema = z.object({
  host: z.string().min(1).meta({
    title: 'Host',
    description: 'The server name or address. A read replica is a good choice.',
    examples: ['warehouse-replica.internal'],
  }),
  port: z.int().min(1).max(65535).default(9000).meta({ title: 'Port' }),
  tls: z.enum(['verify-full', 'disable']).default('verify-full').meta({ title: 'TLS' }),
});

const secretSchema = z.object({
  password: z.string().meta({ title: 'Password' }),
});

export const warehouseConnector = defineConnector({
  kind: 'warehouse',
  displayName: 'Warehouse',
  description: 'A Warehouse database, queried with SQL in read-only sessions.',
  language: 'sql',
  dialect: 'postgres',
  configSchema,
  secretSchema,
  describeTarget: (config) => `warehouse://${config.host}:${config.port}`,
  open({ config, secret }): ConnectorInstance {
    const pool = openPool(config, secret.password); // must not connect yet
    return {
      test: (signal) => test(pool, signal),
      describe: (signal) => describe(pool, signal),
      sampleValues: (field, limit, signal) => sampleValues(pool, field, limit, signal),
      execute: (query, context) => execute(pool, query, context),
      close: () => pool.end(),
    };
  },
});
```

The settings schemas drive the forms:

- Each property becomes one field. `.meta()` gives its `title`, `description` (the hint) and
  `examples` (the placeholder).
- A string is a text input, a number an input for numbers, an enum a select, a boolean a switch.
- `.default()` fills the form and applies when the field is left empty.
- Keep both schemas flat. The forms do not render nested objects.
- `configSchema` is stored in plain text and shown to admins. Credentials never go in it.
- `secretSchema` is sealed with AES-GCM and never returned. The edit form leaves it empty, and an
  empty field keeps the stored value.

`describeTarget` is optional. It returns the line shown under the connector's name. It must not
include credentials.

`kind` is stored with every connector. Never rename it once released.

## 3. Implement the connection

`open` receives the parsed settings and returns a `ConnectorInstance`. It must not contact the
source: the first call does.

| Method                               | Contract                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `test(signal)`                       | Resolves a `HealthReport`, also when the source is down (`ok: false`). Set `readOnly` when the source can tell, else `null`.                |
| `describe(signal)`                   | Lists entities and their fields: names, native types, frame types, comments. Never values. Add cheap estimates of rows and distinct values. |
| `sampleValues(field, limit, signal)` | Returns at most `limit` distinct values of one field, and whether that was all of them.                                                     |
| `execute(query, context)`            | Runs the bound query and returns frames named `context.refId`.                                                                              |
| `close()`                            | Releases pooled connections. The core calls it when the connector changes or is deleted.                                                    |

`execute` must respect the whole `ExecutionContext`:

- Stop and reject with a `ConnectorError` when `context.signal` aborts.
- Pass `context.timeoutMs` to the source when it enforces its own timeout.
- Return at most `context.maxRows` rows per frame. `createFrameBuilder` does this: read one row
  more than the limit, stop when `add` returns `false`, and the frame is marked truncated.
- Use `context.timeRange` where the source needs it, such as the start and end of a range query.
  SQL templates carry the range themselves, as bound parameters.

Frames are columnar. Field types are `time` (Unix epoch milliseconds), `number`, `string` and
`boolean`. The core rejects frames that break this shape.

## 4. Report errors

Throw `ConnectorError` for every failure:

```ts
throw new ConnectorError('syntax', 'The query has a syntax error near FROM.', sourceMessage);
```

- `code` is one of `unreachable`, `authentication`, `permission`, `syntax`, `not_found`,
  `timeout`, `rejected` and `internal`.
- `safeMessage` must quote no data. The model receives it at every access level. Table and column
  names are fine; values from rows or labels are not.
- `message` is the source's own text. It may quote data, so the model gets it only at full access.

## 5. Register the kind

Add the kind to `connectorKinds` in `apps/server/src/connectors/registry.ts`. The add form lists
kinds in that order.

## 6. Test the kind

- Run the conformance suite in `<kind>-connector.integration.test.ts`:
  `testConnectorConformance(warehouseConnector, fixture)` from `_shared/test/conformance.ts`. It
  checks the declaration on every run, and the health, schema, frames, row limit, abort, errors and
  samples against a live source with `bun run test:integration`.
- Add a dev source to `dev/docker-compose.yml` with seed data, under a profile named after its set,
  so the suite runs in CI: an `env:up:<set>` and a `test:integration:<set>` script, a set name in
  `integrationFor` (`_shared/test/dev-sources.ts`), and a row in the `integration` job's matrix. A
  kind ships only when its server runs from a free image, with no account.
- Unit test the pure parts (type mapping, error mapping, catalog parsing) in `*.test.ts`.
- Add the kind to the connector section of [`architecture.md`](architecture.md).

## Rules the checks enforce

- A kind imports the core only through `connectors/_shared/index.ts`, never another kind
  (dependency-cruiser rule `connector-kinds-use-the-kit`).
- The kind's folder owns its driver. Prefer a Bun API to a package, and justify a new dependency
  in one line of the commit message.
- A kind that speaks HTTP sends its requests through the kit's `createHttpClient`, never `fetch`
  (a Biome rule). The client keeps them on the source's origin, away from cloud metadata
  addresses, within a timeout and a byte cap.
- No code written by the model runs, anywhere. A kind never evaluates query text as code.
