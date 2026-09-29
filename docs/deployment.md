# Deploying querent

querent ships as one Docker image, `ghcr.io/jboix/querent`, for linux/amd64 and linux/arm64. It
keeps its state in two volumes and reads an optional configuration file.

## Quick start

```sh
docker run -p 3000:3000 -v querent-data:/data -v querent-keys:/keys ghcr.io/jboix/querent
```

This starts querent in open access: everyone who reaches port 3000 is an admin. Use it on a
machine only you can reach, then set up accounts.

## With Docker Compose

[`deploy/`](../deploy/) holds a starting point:

- `compose.yaml`: the service, its `data` and `keys` volumes, and `querent.yaml` mounted
  read-only.
- `querent.yaml`: the configuration, with a first admin and a model provider.
- `.env.example`: the secrets the configuration refers to.

```sh
cd deploy
cp .env.example .env    # fill in the secrets
docker compose up -d
```

Then sign in at <http://localhost:3000> as the admin the file declares.

## The volumes

| Path    | What it holds                                                   |
| ------- | --------------------------------------------------------------- |
| `/data` | The SQLite database: dashboards, threads, users, sealed secrets |
| `/keys` | The keys querent generates on first start                       |

Back the two up apart. The database holds no secret in clear, and the keys open it: whoever holds
both reads everything. Without the keys, stored credentials cannot be read.

Give your own keys instead with `QUERENT_SECRET_KEY`, `QUERENT_SESSION_KEY` and
`QUERENT_PASSWORD_PEPPER`, or their `_FILE` variants for Docker and Kubernetes secrets. A key you
give always wins; querent generates only the ones you leave out.

## The configuration file

querent reads `*.yaml`, `*.yml` and `*.json` files in `/etc/querent` (`QUERENT_CONFIG` names
another file or directory). Each top-level key is a section:

| Section        | What it declares                                                      |
| -------------- | --------------------------------------------------------------------- |
| `server`       | the public URL, trusted proxies, forced authentication mode, logging  |
| `users`        | users by email: name, role, disabled, a first password                |
| `signIn`       | sign-in providers by id, and whether passwords sign in                |
| `connectors`   | connectors by name: kind, settings, secrets, access level, guardrails |
| `model`        | the model gateway: providers, their keys, limits                      |
| `retention`    | how long deleted threads stay in the bin                              |
| `charts`       | chart recipes switched off                                            |
| `queries`      | query builders switched off, and saved queries                        |
| `provisioning` | `prune: true` deletes what the file no longer declares                |

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

querent applies the file again within 5 seconds of a change, without a restart. A change that
does not validate keeps the last good configuration, and admins see why above the settings. The
`server` section is read at startup only; the settings show which changes wait for a restart.

At startup, a file with a mistake stops querent with every issue listed.

### Starting from what you have

Settings → Server → **Export configuration** writes what is set up now as a file, each secret as
a variable reference to fill in. Commit it, mount it, and the interface shows those items as
managed.

## Accounts and sign-in

Accounts need the public URL, the address people reach querent at, set as `server.publicUrl` or
`QUERENT_PUBLIC_URL`. Sign-in works only from that address, and sign-in providers send people
back to it.

- Declare the first admin in `users`, with a `password` reference or without one to sign in
  through a provider with that verified email.
- Set `server.authMode: accounts`, or switch in Settings → Authentication.
- Register querent at each provider with the redirect URI Settings → Authentication shows.

## Behind a reverse proxy

- Serve querent over HTTPS and set the public URL to its `https://` address; querent then sends
  HSTS.
- Set `server.trustedProxyHops` to the number of proxies that add to `X-Forwarded-For`, so the
  sign-in throttle sees the real address.

## Settings → Server

Every system setting shows there with its value and where it comes from: a variable, the file or
the default. A variable wins over the file, and the file over the default. Keys show only where
they come from.
