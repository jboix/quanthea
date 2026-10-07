# Behind a reverse proxy

quanthea speaks plain HTTP on port 3000. To reach it from other machines, put a reverse proxy in
front that serves HTTPS, such as Caddy, nginx or Traefik, and tell quanthea the address people
use. This page lists what quanthea needs from the proxy, gives a working setup for each, and
ends with the problems people meet most.

## What quanthea needs

### 1. HTTPS

The session cookie is `__Host-` and `Secure`, so browsers keep it only over HTTPS, or over
`http://localhost` on the same machine. Over plain HTTP from another machine, signing in seems to
work and then lands back on the sign-in page. Serve quanthea over HTTPS; the proxy holds the
certificate and talks plain HTTP to quanthea.

### 2. The public URL

Set the address people type, with `QUANTHEA_PUBLIC_URL` or `server.publicUrl` in the
[configuration file](configuration.md):

```sh
QUANTHEA_PUBLIC_URL=https://quanthea.example.com
```

- It is an origin only: `https://` and a host name, with a port if not 443. quanthea needs a host
  name of its own; a path such as `https://example.com/quanthea` is refused at startup.
- quanthea accepts a change (a sign-in, a save, a pin) only from a page at that origin. Use the
  exact address people reach: `https://quanthea.example.com` and
  `https://www.quanthea.example.com` are two different origins.
- It builds every link it sends from it: sign-in provider callbacks, links in notifications and
  reports, and the one-time link of `quanthea reset-admin`. A forged `Host` header changes none of
  them.
- With an `https://` address, quanthea sends HSTS, so browsers keep to HTTPS for a year.

Without it, quanthea compares a change's origin with the address the request reached it on. A
proxy that rewrites the `Host` header then makes every change fail with "This request comes from
another site."

### 3. The proxies in front

Set how many proxies add to `X-Forwarded-For`, with `QUANTHEA_TRUSTED_PROXY_HOPS` or
`server.trustedProxyHops`: `1` for one proxy, `2` for a load balancer and a proxy, up to 5.

```sh
QUANTHEA_TRUSTED_PROXY_HOPS=1
```

quanthea limits wrong passwords by account and by address. With `0`, every sign-in seems to come
from the proxy, so a burst of wrong passwords from anyone slows sign-in for everyone. Never set
more hops than there are proxies: the extra entries come from the client, who could then pick
the address quanthea throttles.

### 4. Streams, unbuffered, with a long timeout

Conversations, Ask about this and the agent's runs stream their answers as server-sent events
(`text/event-stream`). quanthea marks them `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
The proxy must pass them on as they come, and keep the connection open while the model thinks:
quanthea closes a connection after 255 seconds of silence, so a read timeout of 300 seconds
covers it.

- Caddy and Traefik stream server-sent events as they come.
- nginx honours `X-Accel-Buffering: no`, but its read timeout is 60 seconds by default: raise it.

### 5. One way in

Let only the proxy reach quanthea. With Docker, publish the port on the loopback address
(`127.0.0.1:3000:3000`), or publish none and let the proxy reach quanthea on a Docker network.
Without Docker, set `QUANTHEA_HOST=127.0.0.1`.

Leave quanthea's own headers as they are: it sets its Content Security Policy and other security
headers itself. Don't cache `/api`.

`GET /api/health` answers `{"status":"ok"}` with no sign-in, for the proxy's health checks.

## Caddy

Caddy gets and renews a certificate for the name on its own.

```caddyfile
quanthea.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

## nginx

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name quanthea.example.com;

  ssl_certificate     /etc/ssl/quanthea/fullchain.pem;
  ssl_certificate_key /etc/ssl/quanthea/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Answers stream as server-sent events: pass them on as they come, and wait for the model.
    proxy_buffering off;
    proxy_read_timeout 300s;
  }
}

server {
  listen 80;
  server_name quanthea.example.com;
  return 301 https://$host$request_uri;
}
```

## Docker Compose with Caddy

The [Compose file](../deploy/) with Caddy beside quanthea. Only Caddy publishes ports; quanthea
is reached on the Compose network.

```yaml
services:
  quanthea:
    image: ghcr.io/jboix/quanthea:vX.Y.Z
    restart: unless-stopped
    environment:
      QUANTHEA_PUBLIC_URL: https://quanthea.example.com
      QUANTHEA_TRUSTED_PROXY_HOPS: 1
    volumes:
      - quanthea-data:/data
      - quanthea-keys:/keys

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from quanthea.example.com --to quanthea:3000

volumes:
  quanthea-data:
  quanthea-keys:
```

Caddy keeps its certificates inside its container here; give it a volume on `/data` to keep them
across restarts.

## Traefik

With Traefik reading Docker labels, and a certificate resolver named `letsencrypt` in its own
configuration:

```yaml
services:
  quanthea:
    image: ghcr.io/jboix/quanthea:vX.Y.Z
    environment:
      QUANTHEA_PUBLIC_URL: https://quanthea.example.com
      QUANTHEA_TRUSTED_PROXY_HOPS: 1
    labels:
      - traefik.enable=true
      - traefik.http.routers.quanthea.rule=Host(`quanthea.example.com`)
      - traefik.http.routers.quanthea.entrypoints=websecure
      - traefik.http.routers.quanthea.tls.certresolver=letsencrypt
      - traefik.http.services.quanthea.loadbalancer.server.port=3000
```

Traefik sets no limit on how long a response takes by default. If your entry point sets
`respondingTimeouts.writeTimeout`, give it 300 seconds or more.

## Sign-in providers

A provider sends people back to `<public URL>/api/auth/providers/<id>/callback`. Settings →
Authentication shows the exact address for each provider: register it at the provider as it is
written there. Providers need the public URL, so set it before you set one up.

## When something goes wrong

| What you see                                                             | Why                                                        | What to do                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| quanthea stops at start: "Use https\://, or http\:// on localhost only." | The public URL is `http://` on a host name.                | Give its `https://` address.                                                |
| quanthea stops at start: "Give the origin only".                         | The public URL has a path, such as `/quanthea`.            | Serve quanthea on a host name of its own, at `/`.                           |
| Signing in returns to the sign-in page.                                  | The page is served over plain HTTP from another machine.   | Serve it over HTTPS.                                                        |
| Signing in or saving fails: "This request comes from another site."      | The address in the browser is not the public URL.          | Set the public URL to exactly the address people use, or send people to it. |
| An answer appears all at once at the end, or the thread waits.           | The proxy buffers the stream.                              | Turn buffering off for quanthea (`proxy_buffering off` in nginx).           |
| A long answer stops with an error after about a minute.                  | The proxy's read timeout is too short.                     | Raise it to 300 seconds (`proxy_read_timeout 300s` in nginx).               |
| After a few wrong passwords, nobody can sign in for a while.             | Every sign-in seems to come from the proxy.                | Set the trusted proxy hops to the number of proxies.                        |
| The provider refuses the sign-in: the redirect URI does not match.       | The callback registered at the provider is not quanthea's. | Register the callback Settings → Authentication shows.                      |
| Links in notifications point to the wrong place, or have no host.        | The public URL is not set, or is an old address.           | Set it to the address people use.                                           |
