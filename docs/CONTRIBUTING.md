# Contributing to querent

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
serves the app.

Requirements: Bun at the version in `.tool-versions`. Bun runs the TypeScript source directly, so
the server needs no build step. `bun run dev` starts the server and the Vite dev server, both
reloading. `bun run format` applies Biome's formatting, and `bun run docs:format` formats the
Markdown.

## Layout

| Path              | Contents                                                          |
| ----------------- | ----------------------------------------------------------------- |
| `apps/server`     | `@querent/server`: Bun + Hono API, SQLite, serves the built SPA   |
| `apps/web`        | `@querent/web`: React SPA, React Router in data mode, Vite        |
| `packages/shared` | `@querent/shared`: API contracts and roles, imported by both apps |
| `docs`            | Architecture, dashboard spec, brand, contributing, security       |

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
