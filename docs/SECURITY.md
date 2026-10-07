# Security Policy

## Supported Versions

At any given time we support the _latest_ version of quanthea (as reflected in the _main_ branch)
with security updates.

## Reporting a Vulnerability

If you think you have found a vulnerability, please report it responsibly. Do not create a GitHub
issue for a security problem. Instead,
[report a vulnerability](https://github.com/jboix/quanthea/security/advisories/new) privately on
GitHub, and we will look into it as soon as we can.

We appreciate any responsible disclosure of vulnerabilities that might impact the integrity of our
users and their data. We do not offer bounties, but if you wish we will credit you in the release
notes.

Before reporting, make sure you are on the latest version of quanthea.

## What counts

quanthea makes these guarantees. A way around any of them is a vulnerability:

- The model never receives data beyond its connector's access level, and never a hidden column.
- No text written by a model runs as code, in the browser or on the server.
- The browser cannot make the server run a query that is not in a saved dashboard.
- Variable values cannot change the structure of a query.
- A request cannot act with a stronger role than its principal holds.
- Connector credentials, model keys and sign-in provider secrets are never returned by the API.
- Only a thread's owner writes in it. Admins read and delete others' threads, and never write in
  them. Drafts are visible to their thread's owner and admins only.
- A copy of the database, without the keys, yields no secret, password, session, one-time link,
  name, email or provider id.
- A sign-in through a provider completes once, only in the browser that started it, and only with
  an ID token the provider signed for quanthea.
- No link sends a person to another site after they sign in.

Some behaviour is by design and not a vulnerability:

- The first start writes the default admin's password to the log, once. Whoever reads the log
  before the admin sets up their account can sign in as them. Set the account up right after the
  first start, or declare the first admin in the configuration file.
- At the full access level, the model sees result rows, capped by the row limit.
- Hidden columns are matched by name, in any case. A query that renames or aliases a hidden column
  passes the filter: at the aggregates level its five most frequent values reach the model, at the
  full access level its rows. Give the connector a database role or view that cannot read those
  columns when you need a hard guarantee.

## Threat model

quanthea is self-hosted and open source, so an attacker can read every line of it. Its defences
rest on the keys, never on the code staying unknown.

### What quanthea defends against

| Threat                                            | Defence                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stolen database file or backup                  | Secrets, names, emails and provider ids are sealed with AES-GCM under a key kept outside the data directory. Lookups use keyed hashes. Session ids and one-time tokens are stored as keyed hashes. |
| A stolen password hash                            | argon2id (64 MiB, 3 passes) over an HMAC with a pepper that never reaches the database.                                                                                                            |
| Password guessing                                 | Waits that double per account and per address, up to an hour. Every failure gets the same answer after the same work.                                                                              |
| Finding out who has an account                    | Unknown emails, wrong passwords and disabled accounts get the same answer and the same timing.                                                                                                     |
| Stealing a session through a script in the page   | The session cookie is HttpOnly with the `__Host-` prefix. A strict CSP allows no inline script. No text from a model runs as code, and React never renders it as HTML.                             |
| Cross-site request forgery                        | Every write needs a custom header, an `Origin` equal to quanthea's, and a same-origin `Sec-Fetch-Site`. Cookies are SameSite=Lax. Signing out is a POST.                                           |
| A stolen session cookie                           | The cookie is signed. A session ends after 24 hours idle or 7 days in all, on a password change, on a mode switch, and on sign out everywhere.                                                     |
| A forged or replayed provider callback            | PKCE, a random state and a nonce, kept in a sealed cookie used once within 10 minutes.                                                                                                             |
| A forged ID token                                 | Its signature is checked against the provider's published keys, with its issuer, audience, expiry and nonce. `alg: none` is refused.                                                               |
| Taking over an account through a provider's email | An email from a provider only accepts a pending invite, and only when the provider verified it. An account in use is linked only by its owner, signed in.                                          |
| An open redirect after signing in                 | The destination must be a local path of quanthea.                                                                                                                                                  |
| A forged `Host` header                            | Links and callback URLs are built from `QUANTHEA_PUBLIC_URL`, never from the request.                                                                                                              |
| Clickjacking                                      | `frame-ancestors 'none'` and `X-Frame-Options: DENY`.                                                                                                                                              |
| A weaker role doing a stronger role's work        | The server checks the role on every route. A test fails when a route declares no access.                                                                                                           |
| Instructions hidden in data, aimed at the model   | The model sees data only through the access gate, and its output never runs as code or as a query the browser sends.                                                                               |
| A leaked key                                      | Keys rotate with `*_PREVIOUS` variables: every sealed value is sealed again at startup, and passwords are rehashed at their next sign-in.                                                          |

Tests hold these defences. Forged and replayed sign-ins, forged ID tokens, tampered cookies,
cross-site writes, open redirects and probes for accounts are replayed against the server. Another
test stores every kind of secret, then scans the database file, its write-ahead log and its shared
memory for any of them in clear.

### What quanthea trusts

- The host, its environment and its files. Whoever reads the keys and the database together reads
  everything.
- The TLS in front of quanthea. Give `QUANTHEA_PUBLIC_URL` as `https://`, and quanthea sends HSTS.
- The sign-in providers you configure, to say who a person is. A join rule trusts what the provider
  says about a domain, an organisation, a group or a tenant.
- The data sources you connect, to enforce the read-only credentials you give quanthea.
- The connector plugins you install. A plugin runs with the server's rights and can read what
  quanthea reads, keys and database included; it is code the admin chose, not code a model wrote.
  Pins (`plugins.pins`) make sure the plugin that runs is the one installed.

### Known limits

- The sign-in throttle lives in memory. A restart clears it, and several instances each count
  on their own.
- quanthea does not defend against denial of service beyond the throttle and the query guardrails.

## Running quanthea safely

- Let quanthea generate its keys in a keys volume, or give your own with `openssl rand -base64 32`.
  Back the keys up apart from the database: whoever holds both reads everything.
- Set `QUANTHEA_PUBLIC_URL` to quanthea's `https://` origin.
- Install only connector plugins you trust, pin each one, and leave `plugins.allowUnpinned` off.
- Set `QUANTHEA_TRUSTED_PROXY_HOPS` to the number of proxies in front of quanthea, so throttling
  sees the real address.
- Give each connector a read-only database role that can read only what dashboards need.
- Set up the default admin's account right after the first start.
