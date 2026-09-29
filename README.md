<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/querent-logo-dark.svg">
  <img alt="querent" src="docs/brand/querent-logo.svg" height="48">
</picture>

[![Quality](https://github.com/jboix/querent/actions/workflows/quality.yml/badge.svg)](https://github.com/jboix/querent/actions/workflows/quality.yml)
[![Release](https://github.com/jboix/querent/actions/workflows/release.yml/badge.svg)](https://github.com/jboix/querent/actions/workflows/release.yml)
[![bun](https://img.shields.io/badge/bun-1.3.14-brightgreen)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6)](https://www.typescriptlang.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A self-hosted app where you describe a dashboard in a chat and an agent builds it against your data
sources: Prometheus, Postgres, OpenSearch and HTTP APIs. You refine it in the same thread and pin
the good ones. Pinned dashboards are versioned, searchable, and render without any model involved.

querent is at an early stage: the repository, the tooling and an app shell. The design lives in
[`docs/`](docs/).

## Run it

With Docker, from the image each release publishes (`linux/amd64` and `linux/arm64`):

```sh
docker run -p 3000:3000 -v querent-data:/data ghcr.io/jboix/querent:latest
```

Pin a release tag such as `ghcr.io/jboix/querent:v1.0.0` to control upgrades. To build the image
yourself, run `docker build -t querent .` at the repository root.

Open <http://localhost:3000>. The first-run authentication mode is `none`: anyone who reaches the
URL is an admin, and a banner says so.

Without Docker, you need [Bun](https://bun.sh) at the version in `.tool-versions`:

```sh
bun install
bun run build
bun run start
```

## Develop

```sh
bun install
bun run dev
```

`bun run dev` starts the server on port 3000 with hot reload, and Vite on port 5173 with a proxy
for `/api`. Open <http://localhost:5173>.

## Check

```sh
bun run verify
```

This runs, in order: Biome, the Markdown check, the dependency-cruiser boundary rules, knip, tsc
in every workspace, the tests, and the SPA build. CI runs the same steps, and also builds the
Docker image and checks that it serves the app. A git hook runs `bun run verify` before every push.

## Configuration

The server reads these environment variables at startup. Everything else will live in Settings.

| Variable                     | Default         | Purpose                                                                                                                   |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `QUERENT_PORT`               | `3000`          | HTTP port.                                                                                                                |
| `QUERENT_DATA_DIR`           | `./data`        | Holds the SQLite database. Created with mode 0700. `/data` in the image.                                                  |
| `QUERENT_AUTH_MODE`          | unset           | Replaces the stored authentication mode. `none` is the lockout escape hatch.                                              |
| `QUERENT_LOG_LEVEL`          | `info`          | `debug`, `info`, `warn` or `error`.                                                                                       |
| `QUERENT_LOG_FORMAT`         | `text`          | `text` for readable lines, `json` for one JSON object per line.                                                           |
| `QUERENT_WEB_DIR`            | `apps/web/dist` | The built SPA the server serves.                                                                                          |
| `QUERENT_SECRET_KEY`         | generated       | 32 bytes in base64 that encrypt connector credentials. Unset, a key file is created in the data directory with mode 0600. |
| `QUERENT_SESSION_KEY`        | unset           | 32 bytes in base64 that sign session cookies. Required with accounts.                                                     |
| `QUERENT_PASSWORD_PEPPER`    | unset           | 32 bytes in base64 mixed into password hashes. Required with accounts.                                                    |
| `QUERENT_PUBLIC_URL`         | unset           | The address people reach querent at, such as `https://querent.example.com`. Required with accounts.                       |
| `QUERENT_TRUSTED_PROXY_HOPS` | `0`             | How many reverse proxies in front of querent add to `X-Forwarded-For`.                                                    |

Each key can come from a file instead: `QUERENT_SECRET_KEY_FILE`, and so on. Create keys with
`openssl rand -base64 32`, each its own. With accounts, keep the keys out of the data directory: a
copy of the data directory must never carry them. Without the secret key, stored credentials cannot
be read. To rotate it, set the new key and the old one as `QUERENT_SECRET_KEY_PREVIOUS`, restart
once, then remove the old one.

## Layout

| Path              | What it is                                                   |
| ----------------- | ------------------------------------------------------------ |
| `apps/server`     | Bun + Hono API, SQLite, serves the built SPA.                |
| `apps/web`        | React SPA, React Router in data mode, Vite.                  |
| `packages/shared` | API contracts and roles, shared by both apps.                |
| `docs`            | Architecture, dashboard spec, brand, contributing, security. |

[`AGENTS.md`](AGENTS.md) holds the conventions for anyone, human or agent, writing code here.

## Contributing

Read the [contributing guide](docs/CONTRIBUTING.md) before opening a pull request. The
[Code of Conduct](docs/CODE_OF_CONDUCT.md) applies to everyone who takes part. Report a
vulnerability as [SECURITY.md](docs/SECURITY.md) describes.

## License

MIT. See [LICENSE](LICENSE).
