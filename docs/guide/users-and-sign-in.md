# Users and sign-in

People always sign in to quanthea: there is no open access. Admins invite people and give each a
role in **Settings → Users**, and choose how they sign in in **Settings → Authentication**.

## Roles

| Role    | What they do                                                                               |
| ------- | ------------------------------------------------------------------------------------------ |
| Viewer  | Reads pinned dashboards, alerts, reports and their runs, snapshots, questions and answers. |
| Analyst | Also asks questions, has panels explained, and mutes alerts for up to 7 days.              |
| Editor  | Also builds dashboards, alerts and reports, pins, activates, and takes snapshots.          |
| Admin   | Also manages sources, models, users, sign-in, notification channels and settings.          |

No one owns a dashboard. A thread belongs to whoever started it: they write in it, and pin or
unpin what it built. Admins read any thread but never write in it.

## Users

![Settings → Users: each person with their role and last sign-in, and the invite form](../screenshots/settings-users-light.webp#gh-light-mode-only)
![Settings → Users: each person with their role and last sign-in, and the invite form](../screenshots/settings-users-dark.webp#gh-dark-mode-only)

- **Invite someone**: their email, name and role. quanthea gives you a link; they choose their
  own password from it within 72 hours. An invited person can also sign in through a provider
  with that verified email.
- **Change a role**, or **disable** someone: their sessions end at once.
- **Reset link**: a link to choose a new password, valid 24 hours. A new link replaces the old.
- **Sign out everywhere** ends all of someone's sessions.

quanthea always keeps one enabled admin.

### Passwords

A password needs 12 characters or more, with at least 5 different ones. It must not be a
well-known password, or hold the person's name or email.

After 5 failed sign-ins on an account, or 20 from one address, each attempt waits, from a minute
and doubling. Nothing locks an account for good.

A session ends after 24 hours without a request, or 7 days after it began.

### Locked out

`quanthea reset-admin` prints a one-time link that sets an admin's password. See
[Deploy](../deployment.md#locked-out).

## Sign-in providers

![Settings → Authentication: password sign-in, and the sign-in providers](../screenshots/settings-auth-light.webp#gh-light-mode-only)
![Settings → Authentication: password sign-in, and the sign-in providers](../screenshots/settings-auth-dark.webp#gh-dark-mode-only)

quanthea signs people in through **GitHub**, **Google**, **GitLab** (gitlab.com or your own) and
**Microsoft Entra ID** (one tenant). It needs its public URL set; see
[Environment variables](../environment.md).

1. Register quanthea as an OAuth app at the provider, with the redirect URI the form shows.
2. In **Settings → Authentication**, add the provider: paste the client id and secret, and name
   the button.
3. Choose **Who may join**.
4. **Test sign-in**. A provider stays off until a test sign-in with it succeeds.

### Microsoft Entra ID

Entra ID vouches for an email only through the optional `xms_edov` claim. quanthea counts the
email as verified only when that claim is true, never from the sign-in name or the `email` claim
alone. Without it, Entra users neither accept an invite by email nor join the tenant: an invited
person sets a password through the invite link, then links Entra ID from the account menu.

To add the claims, in the Entra admin center open the app registration, then **Token
configuration** → **Add optional claim** → **ID**, and tick `email` and `xms_edov`. Accept the
`email` permission it offers to add.

### Who may join

Invited people always join, with the role they were invited with. A provider may also let others
in, as viewers:

| Provider | Who may join                                                            |
| -------- | ----------------------------------------------------------------------- |
| Google   | Google Workspace accounts of a domain                                   |
| GitHub   | Members of a GitHub organisation                                        |
| GitLab   | Verified emails at a domain, or members of a group (subgroups included) |
| Entra ID | Everyone in the tenant                                                  |

By default a provider lets in invited people only. An account already in use is never linked by
email alone: its owner signs in, and links the provider from the account menu.

### Password sign-in

Password sign-in is on by default. Once an admin can sign in through a provider, you may turn it
off: the sign-in page then shows the provider buttons only.

## In the configuration file

Users, providers and password sign-in can be declared in the configuration file instead, so an
instance can be rebuilt from Git. What the file declares shows a "managed by" badge and is
read-only here. See [the configuration file](../configuration.md#users).
