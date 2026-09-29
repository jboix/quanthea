# Security Policy

## Supported Versions

At any given time we support the _latest_ version of querent (as reflected in the _main_ branch)
with security updates.

## Reporting a Vulnerability

If you think you have found a vulnerability, please report it responsibly. Do not create a GitHub
issue for a security problem. Instead,
[report a vulnerability](https://github.com/jboix/querent/security/advisories/new) privately on
GitHub, and we will look into it as soon as we can.

We appreciate any responsible disclosure of vulnerabilities that might impact the integrity of our
users and their data. We do not offer bounties, but if you wish we will credit you in the release
notes.

Before reporting, make sure you are on the latest version of querent.

## What counts

querent makes these guarantees. A way around any of them is a vulnerability:

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
  an ID token the provider signed for querent.
- No link sends a person to another site after they sign in.

Some behaviour is by design and not a vulnerability:

- In the `none` authentication mode, anyone who can reach the server is an admin. The app shows a
  banner that says so. Put the server behind your own network controls, or switch to accounts.
- At the full access level, the model sees result rows, capped by the row limit. Hidden columns are
  matched by name, so a query that renames a hidden column can pass the filter. Give the connector a
  database role or view that cannot read those columns when you need a hard guarantee.

## Threat model

querent is self-hosted and open source, so an attacker can read every line of it. Its defences
rest on the keys, never on the code staying unknown.

### What querent defends against

| Threat                                            | Defence                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stolen database file or backup                  | Secrets, names, emails and provider ids are sealed with AES-GCM under a key kept outside the data directory. Lookups use keyed hashes. Session ids and one-time tokens are stored as keyed hashes. |
| A stolen password hash                            | argon2id (64 MiB, 3 passes) over an HMAC with a pepper that never reaches the database.                                                                                                            |
| Password guessing                                 | Waits that double per account and per address, up to an hour. Every failure gets the same answer after the same work.                                                                              |
| Finding out who has an account                    | Unknown emails, wrong passwords and disabled accounts get the same answer and the same timing.                                                                                                     |
| Stealing a session through a script in the page   | The session cookie is HttpOnly with the `__Host-` prefix. A strict CSP allows no inline script. No text from a model runs as code, and React never renders it as HTML.                             |
| Cross-site request forgery                        | Every write needs a custom header, an `Origin` equal to querent's, and a same-origin `Sec-Fetch-Site`. Cookies are SameSite=Lax. Signing out is a POST.                                            |
| A stolen session cookie                           | The cookie is signed. A session ends after 24 hours idle or 7 days in all, on a password change, on a mode switch, and on sign out everywhere.                                                     |
| A forged or replayed provider callback            | PKCE, a random state and a nonce, kept in a sealed cookie used once within 10 minutes.                                                                                                             |
| A forged ID token                                 | Its signature is checked against the provider's published keys, with its issuer, audience, expiry and nonce. `alg: none` is refused.                                                               |
| Taking over an account through a provider's email | An email from a provider only accepts a pending invite, and only when the provider verified it. An account in use is linked only by its owner, signed in.                                          |
| An open redirect after signing in                 | The destination must be a local path of querent.                                                                                                                                                   |
| A forged `Host` header                            | Links and callback URLs are built from `QUERENT_PUBLIC_URL`, never from the request.                                                                                                               |
| Clickjacking                                      | `frame-ancestors 'none'` and `X-Frame-Options: DENY`.                                                                                                                                              |
| A weaker role doing a stronger role's work        | The server checks the role on every route. A test fails when a route declares no access.                                                                                                           |
| Instructions hidden in data, aimed at the model   | The model sees data only through the access gate, and its output never runs as code or as a query the browser sends.                                                                               |
| A leaked key                                      | Keys rotate with `*_PREVIOUS` variables: every sealed value is sealed again at startup, and passwords are rehashed at their next sign-in.                                                          |

Tests hold these defences. Forged and replayed sign-ins, forged ID tokens, tampered cookies,
cross-site writes, open redirects and probes for accounts are replayed against the server. Another
test stores every kind of secret, then scans the database file, its write-ahead log and its shared
memory for any of them in clear.

### What querent trusts

- The host, its environment and its files. Whoever reads the keys and the database together reads
  everything.
- The TLS in front of querent. Give `QUERENT_PUBLIC_URL` as `https://`, and querent sends HSTS.
- The sign-in providers you configure, to say who a person is. A join rule trusts what the provider
  says about a domain, an organisation, a group or a tenant.
- The data sources you connect, to enforce the read-only credentials you give querent.

### Known limits

- The sign-in throttle lives in memory. A restart clears it, and several instances each count
  on their own.
- querent does not defend against denial of service beyond the throttle and the query guardrails.

## Running querent safely

- Generate each key with `openssl rand -base64 32`. Keep the secret key outside the data
  directory, and back the keys up apart from the database.
- Set `QUERENT_PUBLIC_URL` to querent's `https://` origin.
- Set `QUERENT_TRUSTED_PROXY_HOPS` to the number of proxies in front of querent, so throttling
  sees the real address.
- Give each connector a read-only database role that can read only what dashboards need.
- Keep open access for a machine only you can reach.
