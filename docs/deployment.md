# Deploying quanthea

quanthea ships as one Docker image, `ghcr.io/jboix/quanthea`, for linux/amd64 and linux/arm64. It
keeps its state in two volumes and reads an optional configuration file.

## Quick start

```sh
docker run -d --name quanthea -p 3000:3000 \
  -v quanthea-data:/data \
  -v quanthea-keys:/keys \
  ghcr.io/jboix/quanthea
```

The first start creates the user `admin` and writes its password to the log, once:

```sh
docker logs quanthea 2>&1 | grep password
```

Sign in at <http://localhost:3000> as `admin` with that password. quanthea then asks for your own
email and password; nothing else opens until you set them.

## With a configuration file

Declare the first admin, and later the model, sources and sign-in, in a `quanthea.yaml`:

```yaml
server:
  publicUrl: http://localhost:3000
users:
  admin:
    password: ${ADMIN_PASSWORD}
```

Put the secrets it refers to in a `.env` file next to it:

```sh
ADMIN_PASSWORD=choose-a-long-password
```

Then start quanthea with the file mounted:

```sh
docker run -d --name quanthea -p 3000:3000 \
  -v quanthea-data:/data \
  -v quanthea-keys:/keys \
  -v ./quanthea.yaml:/etc/quanthea/quanthea.yaml:ro \
  --env-file .env \
  ghcr.io/jboix/quanthea
```

Sign in at <http://localhost:3000> as `admin`, with the `ADMIN_PASSWORD` of `.env`. [The
configuration file](configuration.md) lists everything it can declare.

## The volumes

| Path    | What it holds                                                   |
| ------- | --------------------------------------------------------------- |
| `/data` | The SQLite database: dashboards, threads, users, sealed secrets |
| `/keys` | The keys quanthea generates on first start                      |

The data directory must have mode 0700, readable by quanthea's user only. The image creates
`/data` so. quanthea keeps the database files at mode 0600 and warns at startup when the data
directory lets its group or others in. Outside the image, create it with `mkdir -m 700`, or run
`chmod 700` on an existing one.

`/plugins` holds connector plugins. It is not a volume, so a derived image can install into it;
see [Connector plugins](#connector-plugins).

Back the two up apart. The database holds no secret in clear, and the keys open it: whoever holds
both reads everything. Without the keys, stored credentials cannot be read.

Give your own keys instead with `QUANTHEA_SECRET_KEY`, `QUANTHEA_SESSION_KEY` and
`QUANTHEA_PASSWORD_PEPPER`, or their `_FILE` variants for Docker and Kubernetes secrets. A key you
give always wins; quanthea generates only the ones you leave out.

## Configure it

quanthea reads a configuration file from `/etc/quanthea`, and environment variables. Both are
optional: without them, an admin sets everything up in the interface.

- [The configuration file](configuration.md) declares the server settings, users, sign-in, data
  sources, the model, retention, queries, charts and plugins, with secrets as references.
- [Environment variables](environment.md) lists every variable: the public URL, the ports and
  directories, logging, and the three keys.

## Accounts and sign-in

People always sign in. With a public URL (`server.publicUrl` or `QUANTHEA_PUBLIC_URL`), sign-in
works only from that address, and sign-in providers send people back to it; providers need it.

- Declare the first admin in `users`: `admin`, with a `password` reference, signs in with no
  email; an admin keyed by email signs in with a `password` reference, or through a provider
  with that verified email. Then quanthea creates no `admin` user of its own.
- Register quanthea at each provider with the redirect URI Settings → Authentication shows.

## Locked out

Inside the container, `quanthea reset-admin` prints a one-time link that sets the first admin's
password; `quanthea reset-admin ada@example.com` names the admin. A disabled admin is enabled
again.

```sh
docker exec quanthea quanthea reset-admin
```

## Behind a reverse proxy

- Serve quanthea over HTTPS and set the public URL to its `https://` address; quanthea then sends
  HSTS.
- Set `server.trustedProxyHops` to the number of proxies that add to `X-Forwarded-For`, so the
  sign-in throttle sees the real address.

## Connector plugins

A plugin adds connector kinds: an npm package with a bundled `dist/plugin.js`. quanthea loads the
plugins of `/plugins` (`QUANTHEA_PLUGINS_DIR`; `<data dir>/plugins` outside the image) once, at
startup.

A plugin is code you install, and it runs with the server's rights: it can read what quanthea can
read, the keys and the database included. Install only plugins you trust, like any server
software.

### Built into a derived image (recommended)

The plugins are fixed when the image is built:

```dockerfile
FROM ghcr.io/jboix/quanthea
RUN quanthea plugin install quanthea-plugin-sqlite@1.0.0
```

`quanthea plugin install` takes an npm name with an optional version or range, an `https://`
tarball URL such as a GitHub release asset, or a local `.tgz` or `.js` file. It checks npm's
integrity hash, extracts only the manifest and the bundle, runs the static checks, and prints the
exact version installed and the pin to paste into the configuration file:

```yaml
plugins:
  pins:
    "quanthea-plugin-sqlite": "sha256:f7eb…"
```

It fetches over HTTPS only, redirects included. A tarball URL has no registry hash to check, so
give it the one its publisher gives with `--integrity sha512-…`.

### Installed at runtime

`docker exec quanthea quanthea plugin install quanthea-plugin-sqlite@1.0.0` installs into the
running container, and a restart loads it. This survives recreating the container only when
`/plugins` is mounted as its own volume; otherwise the plugin goes with the container.

### Pins

A pin is a SHA-256 over the plugin's manifest and bundle. A pinned plugin whose files do not
match is refused, and the log says to paste the pin the install printed: an upgrade changes the
pin on purpose. A plugin without a pin loads only when `plugins.allowUnpinned` is true
(`QUANTHEA_PLUGINS_ALLOW_UNPINNED=true` without a configuration file); it is false by default.
The command never writes the configuration, which is often mounted read-only.

`quanthea plugin list` shows each plugin and whether its pin matches; `quanthea plugin remove <name>` deletes one. Changes apply when quanthea restarts. A connector of a kind whose plugin is
gone stays, marked "plugin not installed", until you reinstall the plugin or delete it.
