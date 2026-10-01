# Writing a connector

A **connector kind** teaches quanthea to read one kind of source, such as PostgreSQL. This guide
adds one. A kind is a folder in `apps/server/src/connectors/` and one line in the registry. It ships
no UI and no routes.

Kinds are compiled into the server today. Each kind talks to the core only through the connector
kit, `connectors/_shared/index.ts`, which re-exports the public kit of `packages/plugin-kit`
(`@quanthea/plugin-kit`), so the same code can be loaded as a plugin.

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

A kind declares one of the query languages the core binds: `sql`, `promql`, `logql`, `search`,
`http`, `redis` or `mongodb`. For SQL and PromQL:

- `sql`: the kind also declares its `dialect`: `postgres`, `mysql`, `clickhouse`, `trino`,
  `influxdb` or `ansi`. It receives `SqlQuery`, one read statement with the dialect's placeholders
  (`$1`, `?`, `{p1:String}` or `$p1`) and their values. Send them as driver or protocol
  parameters, never by concatenation. A new dialect needs its literals and placeholders in
  `apps/server/src/query/sql-dialects.ts` first.
- `ansi` is standard SQL, for a source no other dialect fits, such as a plugin's. The kind picks
  `placeholders` (`?`, `$1`, `:1` or `@p1`; `?` by default) and `rowLimit` (`fetch` for
  `FETCH FIRST n ROWS ONLY`, the default, or `limit` for `LIMIT n`). The builders that need
  time buckets, intervals or regular expressions are refused on it; the others work. It does not
  fit, as of now:
  - SQL Server's `OFFSET … FETCH` needs an ORDER BY, so `sql-rows` without a time column fails
    there; `TOP` is not offered, since it changes the SELECT itself;
  - identifiers in `[brackets]`, Oracle's `q'[…]'` strings, backslash escapes, `$$` quotes and
    nested comments are not lexed as literals.
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
  icon: warehouseIcon, // { path, color }: the logo, one SVG path on a 24×24 grid
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
  `examples` (the placeholder). Admins know their database: give a hint only for what they could
  not guess, such as which port an HTTP interface uses.
- A string is a text input, a number an input for numbers, an enum a select, a boolean a switch.
- `.default()` fills the form and applies when the field is left empty.
- Keep both schemas flat. The forms do not render nested objects.
- `configSchema` is stored in plain text and shown to admins. Credentials never go in it.
- `secretSchema` is sealed with AES-GCM and never returned. The edit form leaves it empty, and an
  empty field keeps the stored value.
- The credentials follow a `username` setting, so name the user field `username`.

`aliases` is optional: other names the add form finds the kind by, such as `timescaledb` for
PostgreSQL.

`icon` is optional: the logo, as `{ path, color }`, one SVG path on a 24×24 grid and its brand
colour as `#rrggbb`. The app draws the path in white or black, whichever reads on the colour.
Simple Icons (CC0) has the path of most products. Keep it in `<kind>/icon.ts`.

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
  `testConnectorConformance(warehouseConnector, fixture)` from `@quanthea/plugin-kit/testing`. It
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
  (dependency-cruiser rule `connector-kinds-use-the-kit`). Kinds that share an engine live in one
  folder, as MySQL and MariaDB do in `mysql/`, and Elasticsearch and OpenSearch in `search/`.
- The kind's folder owns its driver. Prefer a Bun API to a package, and justify a new dependency
  in one line of the commit message.
- A kind that speaks HTTP sends its requests through the kit's `createHttpClient`, never `fetch`
  (a Biome rule). The client keeps them on the source's origin, away from cloud metadata
  addresses, within a timeout and a byte cap.
- No code written by the model runs, anywhere. A kind never evaluates query text as code.

## Publishing a plugin

A kind can also ship outside quanthea, as a plugin: an npm package the admin installs with
`quanthea plugin install`. [`examples/quanthea-plugin-sqlite`](../examples/quanthea-plugin-sqlite)
is a complete one to start from.

- **The kit.** Install [`@quanthea/plugin-kit`](https://www.npmjs.com/package/@quanthea/plugin-kit)
  from npm as a development dependency: `bun add -d @quanthea/plugin-kit@^0.1.0`. It holds the
  types a plugin is written against, the test kit and the conformance suite. quanthea passes the
  live kit to the plugin at load, so the bundle carries none of the kit's code.
- **The bundle.** One ES module, built with `bun build src/plugin.ts --outfile dist/plugin.js --target bun`, holding everything the plugin needs: quanthea never installs a plugin's
  dependencies or runs its scripts. Pure JavaScript only; a native module cannot work, since the
  image runs on amd64 and arm64.
- **The entry.** The module exports `kitVersion` (0) and, as default, a function that receives the
  live kit and returns the plugin's kinds:

  ```ts
  import type { ConnectorKit } from '@quanthea/plugin-kit';
  export const kitVersion = 0;
  export default function plugin(kit: ConnectorKit) {
    return [kit.defineConnector({ kind: 'example', configSchema: kit.z.object({ … }), … })];
  }
  ```

  Build the schemas with `kit.z` and throw `kit.ConnectorError`: they are quanthea's own. Import
  only types from `@quanthea/plugin-kit`.
- **The kit version.** The kit's major version equals `kitVersion`. The kit is in beta, 0.x with
  kit version 0: a minor version (0.2.0) adds to the kit, a patch version (0.1.1) fixes it.
  Declare `^0.<minor>.0`, such as `^0.1.0`: npm's caret then takes the fixes, and a new minor
  version is your choice. At 1.0, `kitVersion` becomes 1 and quanthea stops loading plugins built
  for kit version 0.
- **The manifest.** `package.json` names the package `quanthea-plugin-<name>` or
  `@scope/quanthea-plugin-<name>`, carries the `quanthea-plugin` keyword, and the `quanthea` field:
  `{ "kitVersion": 0, "main": "dist/plugin.js" }`. Set `"files": ["dist"]`, so the tarball holds
  the manifest and the bundle.
- **The tests.** Call the plugin with `createTestKit()` from `@quanthea/plugin-kit/testing`, the
  live kit itself, and run `testConnectorConformance` against a real source, in the plugin's
  own CI. quanthea runs the same static checks (`kindProblems`) when it installs and loads it.
- **Any language, any dialect.** A plugin speaks one of the seven query languages; a SQL plugin
  picks a built-in dialect or `ansi`, with its placeholder and row-limit styles.
- **Publishing.** From GitHub Actions, build and run `npm publish --provenance`, which attaches a
  signed build attestation; quanthea does not check it yet. A tarball attached to a GitHub release
  works too: `quanthea plugin install https://…/quanthea-plugin-x-1.0.0.tgz`.
