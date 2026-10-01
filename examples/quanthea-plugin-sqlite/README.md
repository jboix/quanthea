# quanthea-plugin-sqlite

An example connector plugin for quanthea: read-only SQLite files in one directory. It shows what a
plugin is, and it is small enough to copy as a start for your own.

## What a plugin is

- One bundled ES module, `dist/plugin.js`, built with `bun build` from `src/plugin.ts`. It
  includes everything it needs; quanthea installs no dependency and runs no install script.
- It exports `kitVersion`, the kit version it is built for, and as default a function that
  receives the live kit and returns its connector kinds.
- The kit is quanthea's own: `kit.z` builds the forms' schemas, `kit.ConnectorError` reports a
  failure with a message safe to show, `kit.createFrameBuilder` lays out the result.
- `package.json` carries the `quanthea-plugin` keyword and the manifest field:
  `"quanthea": { "kitVersion": 0, "main": "dist/plugin.js" }`.
- The plugin imports only types from `@quanthea/plugin-kit`, a development dependency. Its tests
  call it with `createTestKit()` and run `testConnectorConformance` from
  `@quanthea/plugin-kit/testing`.

## This plugin

- The kind `sqlite-file` runs SQL in the `ansi` dialect, with `?` placeholders and `LIMIT`. The
  core binds every value and refuses every statement but one read; it also refuses ATTACH,
  DETACH, VACUUM, PRAGMA and `load_extension`, which reach other files even from a read-only
  connection.
- A connector names a file relative to `QUANTHEA_SQLITE_ROOT`. Without that variable, no file
  opens. The path is resolved, symbolic links included, and must stay in that directory; `..`
  is refused.
- Files open read-only, with `PRAGMA query_only = ON`.
- Times are ISO 8601 text in UTC; the time range binds as such.
- SQLite runs in the server's process, so a slow query holds it until it ends. Keep to small
  files.

## Build, test, install

```sh
bun run build                 # dist/plugin.js
bun test                      # the conformance suite and the fence, against a seeded file
bun pm pack                   # quanthea-plugin-sqlite-0.1.0.tgz
quanthea plugin install ./quanthea-plugin-sqlite-0.1.0.tgz
```

`quanthea plugin install` prints the pin to paste into the configuration file's `plugins.pins`.
Restart quanthea, set `QUANTHEA_SQLITE_ROOT`, and add a connector of the kind "SQLite file".
