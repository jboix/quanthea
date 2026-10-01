# Deploying querent

querent ships as one Docker image, `ghcr.io/jboix/quanthea`, for linux/amd64 and linux/arm64. It
keeps its state in two volumes and reads an optional configuration file.

## Quick start

```sh
docker run -d --name querent -p 3000:3000 -v quanthea-data:/data -v quanthea-keys:/keys \
  ghcr.io/jboix/quanthea
```

The first start creates the user `admin` and writes its password to the log, once:

```sh
docker logs querent 2>&1 | grep password
```

Sign in at <http://localhost:3000> as `admin` with that password. querent then asks for your own
email and password; nothing else opens until you set them.

## With Docker Compose

[`deploy/`](../deploy/) holds a starting point:

- `compose.yaml`: the service, its `data` and `keys` volumes, and `quanthea.yaml` mounted
  read-only.
- `quanthea.yaml`: the configuration, with the first admin; a model provider, connectors and
  sign-in providers are there to uncomment.
- `.env.example`: the secrets the configuration refers to.

```sh
cd deploy
cp .env.example .env    # fill in the secrets
docker compose up -d
```

Then sign in at <http://localhost:3000> as `admin`, with the `ADMIN_PASSWORD` of `.env`.

## The volumes

| Path    | What it holds                                                   |
| ------- | --------------------------------------------------------------- |
| `/data` | The SQLite database: dashboards, threads, users, sealed secrets |
| `/keys` | The keys querent generates on first start                       |

`/plugins` holds connector plugins. It is not a volume, so a derived image can install into it;
see [Connector plugins](#connector-plugins).

Back the two up apart. The database holds no secret in clear, and the keys open it: whoever holds
both reads everything. Without the keys, stored credentials cannot be read.

Give your own keys instead with `QUANTHEA_SECRET_KEY`, `QUANTHEA_SESSION_KEY` and
`QUANTHEA_PASSWORD_PEPPER`, or their `_FILE` variants for Docker and Kubernetes secrets. A key you
give always wins; querent generates only the ones you leave out.

## The configuration file

querent reads `*.yaml`, `*.yml` and `*.json` files in `/etc/quanthea` (`QUANTHEA_CONFIG` names
another file or directory). Each top-level key is a section:

| Section        | What it declares                                                      |
| -------------- | --------------------------------------------------------------------- |
| `server`       | the public URL, trusted proxies, logging                              |
| `users`        | users by email (or `admin`): name, role, disabled, a first password   |
| `signIn`       | sign-in providers by id, and whether passwords sign in                |
| `connectors`   | connectors by name: kind, settings, secrets, access level, guardrails |
| `model`        | the model gateway: providers, their keys, limits                      |
| `retention`    | how long deleted threads stay in the bin                              |
| `charts`       | chart recipes switched off                                            |
| `queries`      | query builders switched off, and saved queries                        |
| `provisioning` | `prune: true` deletes what the file no longer declares                |
| `plugins`      | the plugins directory, the pin of each plugin, unpinned plugins       |

[`configuration.schema.json`](configuration.schema.json) describes every field. Editors that
read `# yaml-language-server: $schema=…` complete and check the file as you type.

### Secrets

A secret is never written in the file. Each one is a whole reference:

- `"${NAME}"`: the environment variable `NAME`. Quote it inside `{ }`, where YAML would read it
  otherwise.
- `file:/run/secrets/name`: a file, such as a Docker or Kubernetes secret.

querent refuses a secret written in clear, and no message ever quotes one.

### What the file manages

What the file declares is read-only in the interface, with a badge naming the file; what it
leaves out stays editable there. A connector's descriptions stay editable unless the file
declares them.

Remove an item from the file and it stays, editable again in the interface. With
`provisioning: { prune: true }`, querent deletes it instead (a user is disabled).

### Changes

querent reads the file at startup. Restart it to apply a change, to the file or to a secret it
refers to. A file with a mistake stops querent with every issue listed, and nothing is applied.

## Accounts and sign-in

People always sign in. With a public URL (`server.publicUrl` or `QUANTHEA_PUBLIC_URL`), sign-in
works only from that address, and sign-in providers send people back to it; providers need it.

- Declare the first admin in `users`: `admin`, with a `password` reference, signs in with no
  email; an admin keyed by email signs in with a `password` reference, or through a provider
  with that verified email. Then querent creates no `admin` user of its own.
- Register querent at each provider with the redirect URI Settings → Authentication shows.

## Locked out

Inside the container, `quanthea reset-admin` prints a one-time link that sets the first admin's
password; `quanthea reset-admin ada@example.com` names the admin. A disabled admin is enabled
again.

```sh
docker exec querent quanthea reset-admin
```

## Behind a reverse proxy

- Serve querent over HTTPS and set the public URL to its `https://` address; querent then sends
  HSTS.
- Set `server.trustedProxyHops` to the number of proxies that add to `X-Forwarded-For`, so the
  sign-in throttle sees the real address.

## Settings → Server

Every system setting shows there with its value and where it comes from: a variable, the file or
the default. A variable wins over the file, and the file over the default. Keys show only where
they come from.

## Connector plugins

A plugin adds connector kinds: an npm package with a bundled `dist/plugin.js`. querent loads the
plugins of `/plugins` (`QUANTHEA_PLUGINS_DIR`; `<data dir>/plugins` outside the image) once, at
startup.

A plugin is code you install, and it runs with the server's rights: it can read what querent can
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

### Installed at runtime

`docker exec querent quanthea plugin install quanthea-plugin-sqlite@1.0.0` installs into the
running container, and a restart loads it. This survives recreating the container only when
`/plugins` is mounted as its own volume; otherwise the plugin goes with the container.

### Pins

A pin is a SHA-256 over the plugin's manifest and bundle. A pinned plugin whose files do not
match is refused, and the log says to paste the pin the install printed: an upgrade changes the
pin on purpose. A plugin without a pin loads only when `plugins.allowUnpinned` is true
(`QUANTHEA_PLUGINS_ALLOW_UNPINNED=true` without a configuration file); it is false by default.
The command never writes the configuration, which is often mounted read-only.

`quanthea plugin list` shows each plugin and whether its pin matches; `quanthea plugin remove <name>` deletes one. Changes apply when querent restarts. A connector of a kind whose plugin is
gone stays, marked "plugin not installed", until you reinstall the plugin or delete it.
