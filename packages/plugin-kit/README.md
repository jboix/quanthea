# @quanthea/plugin-kit

The kit a [quanthea](https://github.com/jboix/quanthea) connector plugin is written against. A
plugin adds connector kinds, such as a new database, to a quanthea server.

The kit is in beta: version 0.x, kit version 0.

## Install

```sh
bun add -d @quanthea/plugin-kit@^0.1.0
```

It is a development dependency. A plugin imports only types from it, and quanthea passes the live
kit to the plugin when it loads it, so the bundle carries none of the kit's code.

## Write a plugin

The plugin is one bundled ES module. It exports the kit version it is built for and, as default, a
function that receives the kit and returns what the plugin adds, its connector kinds:

```ts
import type { ConnectorKit } from '@quanthea/plugin-kit';

export const kitVersion = 0;

export default function plugin(kit: ConnectorKit) {
  return {
    connectors: [kit.defineConnector({ kind: 'example', configSchema: kit.z.object({ … }), … })],
  };
}
```

- Build the schemas with `kit.z` and throw `kit.ConnectorError`: they are quanthea's own.
- Name the package `quanthea-plugin-<name>` or `@scope/quanthea-plugin-<name>`, with the
  `quanthea-plugin` keyword.
- Add the manifest field to `package.json`: `"quanthea": { "kitVersion": 0, "main": "dist/plugin.js" }`.

[Publishing a plugin](https://github.com/jboix/quanthea/blob/main/docs/connectors.md#publishing-a-plugin)
covers the bundle, the manifest and publishing. The
[SQLite example](https://github.com/jboix/quanthea/tree/main/examples/quanthea-plugin-sqlite) is a
complete plugin to start from.

## Test a plugin

`@quanthea/plugin-kit/testing` runs under `bun test`:

- `createTestKit()` returns the live kit, the same one quanthea passes at load.
- `testConnectorConformance(kind, fixture)` registers the tests every kind passes: the static
  checks quanthea runs at install and load, then queries against a real source.

## Versions

The kit's major version equals `kitVersion`. While the kit is in 0.x:

- A **minor** version, such as 0.2.0, adds to the kit.
- A **patch** version, such as 0.1.1, fixes it.

npm's caret stays within one minor version on 0.x: `^0.1.0` takes the 0.1.x fixes, and moving to
0.2.0 is your choice. At 1.0, the kit becomes 1.0.0 and `kitVersion` becomes 1, and quanthea stops
loading plugins built for kit version 0.

## Licence

MIT
