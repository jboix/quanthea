# Agent guide: querent

Read this fully before writing code. Then read the design docs:

1. [`docs/architecture.md`](docs/architecture.md): layout, module boundaries, flows, data model, API.
2. [`docs/dashboard-spec.md`](docs/dashboard-spec.md): the dashboard spec.
3. [`docs/brand/`](docs/brand/): the logo, icon and mark, and where each is used.

## What this project is

querent is a self-hosted web app. You describe a dashboard in a chat, an agent builds it against
your data sources (Prometheus, Loki, InfluxDB, Postgres and TimescaleDB, MySQL, MariaDB,
ClickHouse, Trino, Elasticsearch, OpenSearch, HTTP APIs), you refine it in the same thread, and you
pin the good ones. Pinned dashboards are versioned, searchable, and render without any model
involved.

## Commands

```sh
bun install          # install dependencies and the git hooks (husky)
bun run dev          # Vite on :5173 (proxies /api) and the server on :3000, both reloading
bun run verify       # the whole gate: lint, docs:check, arch, knip, typecheck, test, build
bun run lint         # Biome check (format + lint)
bun run lint:fix     # Biome check --write
bun run docs:check   # remark: Markdown formatting and links
bun run docs:format  # remark: format the Markdown
bun run arch         # dependency-cruiser boundary rules
bun run knip         # unused files, exports and dependencies
bun run typecheck    # tsc in every workspace
bun test             # unit tests (bun:test)
bun run env:up       # the local data sources: Postgres :5433, Prometheus :9091
bun run test:integration  # connector tests against the local data sources
bun run env:up:timescale && bun run test:integration:timescale  # the same for TimescaleDB
bun run env:up:mysql && bun run test:integration:mysql  # the same for MySQL and MariaDB
bun run env:up:clickhouse && bun run test:integration:clickhouse  # the same for ClickHouse
bun run env:up:trino && bun run test:integration:trino  # the same for Trino
bun run env:up:search && bun run test:integration:search  # Elasticsearch and OpenSearch
bun run env:up:loki && bun run test:integration:loki  # Loki
bun run env:up:http && bun run test:integration:http  # the HTTP JSON connector, on a dev API
bun run env:up:influxdb && bun run test:integration:influxdb  # InfluxDB 3
bun run build        # build the SPA into apps/web/dist
bun run start        # run the server, serving the built SPA
```

Run one test file with `bun test apps/server/src/app.test.ts`.

## Layout

| Workspace         | Package           | What it is                                                         |
| ----------------- | ----------------- | ------------------------------------------------------------------ |
| `apps/server`     | `@querent/server` | Bun + Hono API, SQLite, serves the built SPA.                      |
| `apps/web`        | `@querent/web`    | React SPA, React Router in data mode, Vite. No SSR.                |
| `packages/shared` | `@querent/shared` | API contracts, roles, and later the spec and formatters. Zod only. |

Module boundaries are in the architecture doc, section 3 and 4, and in `.dependency-cruiser.cjs`.

## Non-negotiables

- No model-written code runs anywhere. Biome bans `eval`, `new Function` and
  `dangerouslySetInnerHTML`.
- The model sees data only through `apps/server/src/gate/`. `agent/` never imports
  `connectors/`, `query/` or `db/`.
- The browser never sends a query. Variables are bound, never concatenated.
- No dashboard ownership. Roles are admin, editor and viewer. Every `/api` route declares
  its access (`'public'` or a minimum role) through `mountEndpoint`, and a test fails otherwise.
- Versions are never rewritten. Pinning chooses the version shown, and any version can be pinned.
- The bin holds threads. Deleting a thread moves it there; a thread with a pinned dashboard
  can't be deleted. Usage outlives every purge.
- TypeScript stays on 6.0.x. No path aliases: relative imports inside a workspace,
  package names across workspaces.
- Library versions are newer than most training data. Read the installed type definitions or the
  current docs before using AI SDK 7, React Router 8, ECharts 6 or Zod 4 APIs.

## Conventions

- Each endpoint is declared once in `packages/shared/src/api/` with `defineEndpoint`. The server
  mounts it with `mountEndpoint` and the web calls it with the client in `apps/web/src/lib/`.
- Errors use one shape: `{ error: { code, message, details? } }`. Throw `AppError` on the server.
- Only `db/` touches `bun:sqlite`. Migrations are numbered `.sql` files in
  `apps/server/src/db/migrations/`. Until the first release the schema is one file,
  `0001-schema.sql`: change it in place, and start from a fresh database. No code keeps data from
  older shapes working before then. After the release, never edit an applied migration; add one.
- `apps/web/src/ui/` holds presentational primitives in querent's visual language. Colours,
  radii and fonts come from the tokens in `ui/theme.css`.
- The logo, icon and mark come from `ui/brand.tsx`. The source files and the rule for each variant
  are in `docs/brand/`. The signal orange (`--color-brand-signal`) is for the brand only.
- The browser runs Zod without its JIT (`lib/zod-without-eval.ts`) because the CSP forbids
  `new Function`.
- Prefer the platform (Bun APIs, `fetch`, WebCrypto) over a package. Each new dependency gets one
  line of justification in the commit message.

## Style

- Biome owns formatting and lint: single quotes, semicolons, 2-space indent, 100 columns.
- Cognitive complexity at most 8, functions at most 25 lines, files at most 400 lines. Split the
  code; never raise the limits or disable a rule to pass. Propose a rule change with a reason
  instead.
- Guard clauses first, flat happy path. Names carry meaning: no abbreviations such as `err`,
  `res`, `ctx`, `opts`, `msg`. The Hono context is `context`.
- TSDoc on every declaration, exported or not, with `@param` and `@returns`. Describe the contract,
  not the implementation. `//` comments are for code inside bodies, two lines at most.

## Writing

Documentation, comments, commit messages and user-facing strings use direct language.

- Write plain declarative sentences. State the fact, then at most one sentence of why.
- No em-dashes. Use commas, colons, parentheses, periods.
- One fact per bullet. Paragraphs of one to three short sentences.
- Keep the docs alive: when the code changes a documented behaviour, update
  `docs/architecture.md` in the same commit.

## Commits

- Conventional Commits (`type(scope): description`), enforced by commitlint. The type sets the
  release bump: `fix` patch, `feat` minor, `feat!` major (semantic-release, run from the Release
  workflow).
- Small commits, each passing `bun run verify`.
- Husky runs Biome on staged files before a commit, commitlint on the message, and
  `bun run verify` before a push. Do not skip hooks.

## What not to do

- Do not fan out parallel agents over one working tree. If parallel work is needed, each agent gets
  its own git worktree, and no agent runs `git stash`, `git checkout` or `git restore` on files it
  does not own.
- Do not add SSR, React Router framework mode, or path aliases.
- Do not embed an identity provider (no Keycloak). Authentication is open, Basic or generic OIDC.
- Do not weaken a lint, knip or dependency-cruiser rule to get a check green.
