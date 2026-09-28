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
- Connector credentials and model keys are never returned by the API.

Some behaviour is by design and not a vulnerability:

- In the `none` authentication mode, anyone who can reach the server is an admin. The app shows a
  banner that says so. Put the server behind your own network controls, or switch to `basic` or
  `oidc`.
- At the full access level, the model sees result rows, capped by the row limit. Hidden columns are
  matched by name, so a query that renames a hidden column can pass the filter. Give the connector a
  database role or view that cannot read those columns when you need a hard guarantee.
