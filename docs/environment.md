# Environment variables

Every variable quanthea reads. Each system setting can also come from the
[configuration file](configuration.md)'s `server` section: a variable wins over the file, and the
file over the default. **Settings → Server** shows each setting's value and where it comes from.

quanthea reads them at startup. Restart it to apply a change.

## Server

| Variable                          | Default              | In the image    | What it sets                                                                  |
| --------------------------------- | -------------------- | --------------- | ----------------------------------------------------------------------------- |
| `QUANTHEA_PUBLIC_URL`             | none                 | none            | The address people reach quanthea at, such as `https://quanthea.example.com`. |
| `QUANTHEA_TRUSTED_PROXY_HOPS`     | `0`                  | `0`             | Reverse proxies in front that add to `X-Forwarded-For`, up to 5.              |
| `QUANTHEA_PORT`                   | `3000`               | `3000`          | The HTTP port.                                                                |
| `QUANTHEA_DATA_DIR`               | `./data`             | `/data`         | The SQLite database.                                                          |
| `QUANTHEA_KEYS_DIR`               | `./keys`             | `/keys`         | The keys quanthea generates. Never inside the data directory.                 |
| `QUANTHEA_CONFIG`                 | none                 | `/etc/quanthea` | The configuration file, or a directory of them.                               |
| `QUANTHEA_WEB_DIR`                | the built web app    | the built app   | The web app the server serves.                                                |
| `QUANTHEA_LOG_LEVEL`              | `info`               | `info`          | `debug`, `info`, `warn` or `error`.                                           |
| `QUANTHEA_LOG_FORMAT`             | `text`               | `text`          | `text` for readable lines, `json` for one object per line.                    |
| `QUANTHEA_PLUGINS_DIR`            | `<data dir>/plugins` | `/plugins`      | Where connector plugins are installed.                                        |
| `QUANTHEA_PLUGINS_ALLOW_UNPINNED` | `false`              | `false`         | Load plugins that have no pin in the configuration.                           |

### The public URL

Set `QUANTHEA_PUBLIC_URL` for any instance people reach from other machines.

- Sign-in works only from that address, and requests from another origin are refused.
- Sign-in providers send people back to it, and their redirect URI is built from it.
- Links in alert and report messages point at it.
- With an `https://` address, quanthea sends HSTS.

Behind a reverse proxy, set it to the proxy's `https://` address and set
`QUANTHEA_TRUSTED_PROXY_HOPS` to the number of proxies, so the sign-in throttle sees the real
address.

## Keys

quanthea uses three keys. Each is 32 random bytes in base64:

```sh
openssl rand -base64 32
```

| Variable                   | What it does                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `QUANTHEA_SECRET_KEY`      | Seals secrets at rest: credentials, API keys, names and emails.   |
| `QUANTHEA_SESSION_KEY`     | Signs session cookies, and keys the hashes of sessions and links. |
| `QUANTHEA_PASSWORD_PEPPER` | Is mixed into every password hash.                                |

- Each has a `_FILE` variant, such as `QUANTHEA_SECRET_KEY_FILE=/run/secrets/quanthea-secret`,
  for Docker and Kubernetes secrets. Set one or the other, not both.
- quanthea refuses to start when any key file is inside the data directory.
- A key you don't give is generated on first start in the keys directory. A key you give always
  wins, key by key.
- quanthea refuses a key that isn't 32 bytes, looks like a passphrase, or is used for two roles.
- Back up the keys apart from the data volume: whoever holds both reads everything, and without
  the keys stored credentials can't be read.

### Rotating a key

1. Set the new key, and the old one as `QUANTHEA_SECRET_KEY_PREVIOUS`.
2. Restart. quanthea seals every secret again with the new key.
3. Remove the previous key, and restart again.

The pepper rotates the same way with `QUANTHEA_PASSWORD_PEPPER_PREVIOUS`: each password is
hashed again at its owner's next sign-in, so keep the previous pepper until everyone has signed in.
Both `_PREVIOUS` variables have `_FILE` variants too.

A secret key that can't open what the database holds stops the server at startup, naming the id
of the key that sealed it.

## Your own variables

The configuration file reads any variable you name, such as `${ORDERS_DB_PASSWORD}` or
`${ANTHROPIC_API_KEY}`. Pass them as you pass the ones above: `--env-file .env` with Docker,
`env_file` in Compose, or a Kubernetes secret. See
[the configuration file](configuration.md#secrets-and-variables).
