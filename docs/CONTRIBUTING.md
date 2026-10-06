# Contributing to quanthea

Thanks for contributing. Agents working in this repository also follow
[AGENTS.md](../AGENTS.md). Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

```sh
bun install
bun run verify    # everything CI checks
```

`verify` runs:

| Step                 | Tool               | Checks                                                       |
| -------------------- | ------------------ | ------------------------------------------------------------ |
| `bun run lint`       | Biome              | Formatting, lint rules, complexity and length limits         |
| `bun run docs:check` | remark             | Markdown formatting, broken links                            |
| `bun run arch`       | dependency-cruiser | Module boundaries (the gate, the workspaces), cycles         |
| `bun run knip`       | knip               | Dead code, unused exports and dependencies                   |
| `bun run typecheck`  | tsc                | Type errors in every workspace, `exactOptionalPropertyTypes` |
| `bun run test`       | bun test           | Unit tests of the three workspaces                           |
| `bun run build`      | Vite               | The SPA builds                                               |

CI runs the same steps, reports coverage, and also builds the Docker image and checks that it
serves the app. `bun run test:coverage` then `bun run coverage:areas` print the same coverage by
workspace, by server module and by part of the web app.

Requirements: Bun at the version in `.tool-versions`. Bun runs the TypeScript source directly, so
the server needs no build step. `bun run dev` starts the server and the Vite dev server, both
reloading. `bun run format` applies Biome's formatting, and `bun run docs:format` formats the
Markdown.

## Layout

| Path                  | Contents                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| `apps/server`         | `@quanthea/server`: Bun + Hono API, SQLite, serves the built SPA          |
| `apps/web`            | `@quanthea/web`: React SPA, React Router in data mode, Vite               |
| `apps/site`           | `@quanthea/site`: the website, with these docs, built by Astro            |
| `packages/shared`     | `@quanthea/shared`: API contracts and roles, imported by both apps        |
| `packages/plugin-kit` | `@quanthea/plugin-kit`: the connector kit, for built-in kinds and plugins |
| `packages/tokens`     | `@quanthea/tokens`: the design tokens, for the web app and the website    |
| `examples/`           | example connector plugins, such as `quanthea-plugin-sqlite`               |
| `dev`                 | `@quanthea/dev`: the local data sources and the synthetic metrics         |
| `docs`                | Architecture, specs, configuration, the user guide, brand, security       |

## Website

`apps/site` is the website: the landing page, pricing, and the user docs of `docs/`, read in
place. The list of published docs is `publishedDocs` in `apps/site/src/lib/doc-paths.ts`; any
other file in `docs/` is never read, and links to it go to GitHub.
`bun run site:dev` serves it on port 4321 and reloads as you edit a doc; `bun run site:build`
builds it, indexes the docs for search, and checks every internal link and every page's head.
`GEMINI_API_KEY=… bun run screenshots` takes the docs' screenshots, each in the light and the
dark scheme, on the dev data (`bun run env:up`). Its first run fills a scratch instance through the
agent; later runs reuse it, so retaking the shots after a change to the interface costs no model
call.
Product facts the site states (sources, channels, models, chart types) live in
`apps/site/src/data/facts.ts`, and a test compares them with the code.

The Website workflow deploys it to GitHub Pages. The repository's Pages source must be set to
"GitHub Actions" once, in Settings → Pages.

## Local data sources

```sh
bun run env:up     # Postgres on :5433 and Prometheus on :9091, seeded with the checkout incident
bun run env:down   # stop them and delete their data
```

The incident is always yesterday: each `env:up` script seeds its sources again when their data
was seeded on an earlier day.

`bun run test:integration` runs the connector tests against them. `bun run env:up:timescale`
starts TimescaleDB on :5434, and `bun run test:integration:timescale` runs its tests. `bun run env:up:mysql` starts
MySQL on :3307 and MariaDB on :3308, and `bun run test:integration:mysql` runs their tests.
`bun run env:up:clickhouse` starts ClickHouse on :8124, and `bun run test:integration:clickhouse`
runs its tests. `bun run env:up:trino` starts Trino on :8081 over the dev Postgres, and
`bun run test:integration:trino` runs its tests.
`bun run env:up:search` starts Elasticsearch on :9201 and OpenSearch on :9202 with the request
logs, and `bun run test:integration:search` runs their tests. `bun run env:up:loki` starts Loki on
:3101 with the same logs, and `bun run test:integration:loki` runs its tests. `bun run env:up:http`
starts the dev HTTP API on :8085, and `bun run test:integration:http` runs its tests.
`bun run env:up:influxdb` starts InfluxDB 3 on :8186, and `bun run test:integration:influxdb` runs
its tests. `bun run env:up:valkey` starts Valkey on :6380, and `bun run test:integration:valkey`
runs its tests. `bun run env:up:mongodb` starts MongoDB on :27018, and
`bun run test:integration:mongodb` runs its tests. The sources, their users and the
incident they share are described in [the architecture](./architecture.md#14-local-development).

## Adding a connector

A new kind of data source is a folder in `apps/server/src/connectors/` and one line in the
registry. [Writing a connector](./connectors.md) walks through it.

## Git hooks

`bun install` installs the hooks (husky):

- **pre-commit**: Biome on the staged files.
- **commit-msg**: commitlint.
- **pre-push**: the full `bun run verify`.

## Commits

Conventional Commits (`type(scope): description`), enforced locally and in CI. Each commit passes
`bun run verify` on its own. A new dependency gets one line in the commit body saying why the
platform (Bun APIs, `fetch`, WebCrypto) was not enough.

semantic-release cuts releases from the commit history when the Release workflow is run, and
publishes the Docker image to GHCR. The type you choose is the version bump you cause:

- `fix:` patch, `feat:` minor, `feat!:` or `BREAKING CHANGE:` major.
- `docs:`, `chore:`, `test:`, `refactor:`, `ci:`, `build:` produce no release.

The plugin kit (`@quanthea/plugin-kit`) has its own version. The Release workflow runs
semantic-release for it on the commits that changed `packages/plugin-kit`, with the same rules,
and publishes it to npm. Scope those commits `plugin-kit`. The kit's major version equals
`kitVersion`, so while the kit is in 0.x:

- Never mark a kit commit `!` or `BREAKING CHANGE`. Going to 1.0 is a deliberate breaking
  release, with `kitVersion` set to 1 in the same commit.
- A `feat` makes a minor version, such as 0.1.0 to 0.2.0; a `fix` a patch, such as 0.1.1.

The plugin generator (`@quanthea/create-plugin`) is released the same way from the commits that
changed `packages/create-plugin`. Scope those commits `create-plugin`.

Write the subject line for the changelog reader, not the diff reader.

## Changing behavior

- Update [the architecture](./architecture.md) in the same change as the code it describes.
- The model sees data only through the access gate, and no model-written code runs anywhere.
  dependency-cruiser and Biome enforce both.
- Every `/api` endpoint is declared once in `packages/shared` and declares its access: public or a
  minimum role. A test fails otherwise.
- A pinned dashboard never changes. Deleting moves it to the bin.

## Style

- Biome owns formatting and lint. The limits (cognitive complexity 8, 25 lines per function, 400
  lines per file) are errors: split the code rather than raising them.
- Documentation, comments and user-visible strings use plain, direct language. The rules are in
  the Writing section of [AGENTS.md](../AGENTS.md).

If `bun run verify` passes, the style is right. Do not argue with a check in a pull request; open
an issue instead.

## Pull requests

Keep them scoped to one change. CI runs the same `verify` chain, the Docker image check and commit
linting. A pull request merges with a green `quality` check and a review from the maintainer.
