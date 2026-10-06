<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/quanthea-logo-dark.svg">
  <img alt="quanthea" src="docs/brand/quanthea-logo.svg" height="48">
</picture>

[![Quality](https://github.com/jboix/quanthea/actions/workflows/quality.yml/badge.svg)](https://github.com/jboix/quanthea/actions/workflows/quality.yml)
[![Release](https://github.com/jboix/quanthea/actions/workflows/release.yml/badge.svg)](https://github.com/jboix/quanthea/actions/workflows/release.yml)
[![version](https://img.shields.io/github/v/release/jboix/quanthea?label=version)](https://github.com/jboix/quanthea/releases/latest)
[![bun](https://img.shields.io/badge/bun-1.4.2-brightgreen)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6)](https://www.typescriptlang.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A self-hosted app where you describe a dashboard in a chat and an agent builds it against your data
sources: Prometheus, Loki, InfluxDB, Postgres and TimescaleDB, MySQL, MariaDB, ClickHouse, Trino,
Elasticsearch, OpenSearch, Valkey, MongoDB and HTTP APIs. You refine it in the same thread and pin
the good ones. Pinned dashboards are versioned, searchable, and render without any model involved.

See it at [quanthea.ch](https://quanthea.ch): what it does, screenshots, and the
[user guide](https://quanthea.ch/docs/getting-started/).

## Try it

The demo runs on a Postgres and a Prometheus with an outdoor shop's last 60 days of sample data, an
incident yesterday included, and uses Gemini as the model. It needs [Bun](https://bun.sh), Docker
and a [Gemini API key](https://aistudio.google.com/apikey).

```sh
bun install
bun run env:up                     # the sample Postgres and Prometheus, in Docker
GEMINI_API_KEY=… bun run demo      # builds the app and starts it on port 3000
```

Open <http://localhost:3000>, sign in as `admin` with the password `quanthea-demo`, and ask
"What happened to checkout yesterday around 14:00?". The demo keeps its state in `.demo/`; delete
it to start over. `bun run env:down` removes the sample data sources.

## Run it

With Docker, from the image each release publishes (`linux/amd64` and `linux/arm64`):

```sh
docker run -d --name quanthea -p 3000:3000 \
  -v quanthea-data:/data \
  -v quanthea-keys:/keys \
  ghcr.io/jboix/quanthea
```

Pin a release tag such as `ghcr.io/jboix/quanthea:v1.0.0` to control upgrades. To build the image
yourself, run `docker build -t quanthea .` at the repository root.

Open <http://localhost:3000> and sign in as `admin` with the password the first start writes to
the log (`docker logs quanthea`). quanthea then asks for your own email and password. Locked out?
`docker exec quanthea quanthea reset-admin` prints a one-time link.

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
in every workspace, the tests, the SPA build, the website build and the plugin package checks. CI
runs the same steps, and also builds the Docker image and checks that it serves the app. A git hook runs `bun run verify` before every push.

## Configuration

[`docs/deployment.md`](docs/deployment.md) shows how to run quanthea with Docker Compose and a
configuration file; [`deploy/`](deploy/) holds a starting point.

The server reads these settings at startup, from an environment variable or, when no variable is
set, from the configuration file's `server` section. Settings → Server shows each one with where
it comes from. Everything else lives in Settings.

| Variable                      | Default         | Purpose                                                                                                      |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `QUANTHEA_PORT`               | `3000`          | HTTP port.                                                                                                   |
| `QUANTHEA_DATA_DIR`           | `./data`        | Holds the SQLite database. Created with mode 0700. `/data` in the image.                                     |
| `QUANTHEA_KEYS_DIR`           | `./keys`        | Holds the keys quanthea generates. Created with mode 0700, outside the data directory. `/keys` in the image. |
| `QUANTHEA_CONFIG`             | unset           | A YAML or JSON configuration file, or a directory of them. `/etc/quanthea` in the image.                     |
| `QUANTHEA_LOG_LEVEL`          | `info`          | `debug`, `info`, `warn` or `error`.                                                                          |
| `QUANTHEA_LOG_FORMAT`         | `text`          | `text` for readable lines, `json` for one JSON object per line.                                              |
| `QUANTHEA_WEB_DIR`            | `apps/web/dist` | The built SPA the server serves.                                                                             |
| `QUANTHEA_SECRET_KEY`         | generated       | 32 bytes in base64 that encrypt credentials, names and emails at rest.                                       |
| `QUANTHEA_SESSION_KEY`        | generated       | 32 bytes in base64 that sign session cookies.                                                                |
| `QUANTHEA_PASSWORD_PEPPER`    | generated       | 32 bytes in base64 mixed into password hashes.                                                               |
| `QUANTHEA_PUBLIC_URL`         | unset           | The address people reach quanthea at, such as `https://quanthea.example.com`. Required with accounts.        |
| `QUANTHEA_TRUSTED_PROXY_HOPS` | `0`             | How many reverse proxies in front of quanthea add to `X-Forwarded-For`.                                      |

In the configuration file, each setting takes its name without the prefix, in camel case:

```yaml
server:
  publicUrl: https://quanthea.example.com
  trustedProxyHops: 1
```

`${NAME}` in a value is replaced by the environment variable `NAME`. Keys never go in the file.

Each key can come from a file instead: `QUANTHEA_SECRET_KEY_FILE`, and so on. A key not given is
generated on first start in the keys directory, with mode 0600; a key given always wins, key by
key. Back the keys up apart from the data: a copy of the data directory must never carry them.
Without the secret key, stored credentials cannot be read. To rotate it, set the new key and the
old one as `QUANTHEA_SECRET_KEY_PREVIOUS`, restart once, then remove the old one.

## Website

`apps/site` is the website at <https://quanthea.ch/>: the landing page, pricing, and these docs,
read from `docs/` in place. It is static, built by Astro.

```sh
bun run site:dev      # http://localhost:4321, reloading as the docs change
bun run site:build    # apps/site/dist, with the search index and the link and head checks
```

The Website workflow (`.github/workflows/site.yml`) builds it and deploys it to GitHub Pages on a
push to `main` that touches the site, the docs, the tokens or `packages/shared`, on each release,
and on demand; pull requests deploy nothing. The repository's Pages source is "GitHub Actions"
(Settings → Pages). The site's address and base path are the ones Pages gives: the custom domain
set there at `/`, else `https://jboix.github.io/quanthea/`. The repository variables `SITE_URL`
and `SITE_BASE` override them. Under a path such as `/quanthea`, crawlers ignore the site's
`robots.txt`, so submit the sitemap (`sitemap-index.xml`) in Search Console instead.

## Layout

| Path                     | What it is                                                   |
| ------------------------ | ------------------------------------------------------------ |
| `apps/server`            | Bun + Hono API, SQLite, serves the built SPA.                |
| `apps/web`               | React SPA, React Router in data mode, Vite.                  |
| `apps/site`              | The website: landing page, pricing and these docs, by Astro. |
| `packages/shared`        | API contracts and roles, shared by both apps.                |
| `packages/plugin-kit`    | The connector kit, on npm as `@quanthea/plugin-kit`.         |
| `packages/create-plugin` | The plugin generator: `npm create @quanthea/plugin`.         |
| `packages/tokens`        | The design tokens, shared by the web app and the website.    |
| `examples/`              | An example connector plugin: read-only SQLite files.         |
| `docs`                   | Architecture, dashboard spec, brand, contributing, security. |

[`AGENTS.md`](AGENTS.md) holds the conventions for anyone, human or agent, writing code here.

## Contributing

Read the [contributing guide](docs/CONTRIBUTING.md) before opening a pull request. The
[Code of Conduct](docs/CODE_OF_CONDUCT.md) applies to everyone who takes part. Report a
vulnerability as [SECURITY.md](docs/SECURITY.md) describes.

## License

MIT. See [LICENSE](LICENSE).
