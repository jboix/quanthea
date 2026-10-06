# History, the bin and retention

quanthea keeps history by design: versions are never rewritten, deleting goes to a bin first, and
usage outlives every purge. Admins decide how long the bin and report runs keep things.

## Versions

Dashboards, alerts and reports have versions, and no version is ever rewritten.

- A dashboard shows its pinned version. **Versions** in its header lists them all, with what
  changed; editors pin any of them, an earlier one included.
- An alert or a report runs its active version. **Versions** lists who saved each and when;
  editors activate another.
- Each change in a thread, by the agent or by hand, is a new version.

## The bin

![The bin: deleted threads and conversations, who deleted them, and when each goes for good](../screenshots/bin-light.webp#gh-light-mode-only)
![The bin: deleted threads and conversations, who deleted them, and when each goes for good](../screenshots/bin-dark.webp#gh-dark-mode-only)

Deleting a thread moves it to the **Bin**, with what it built. So does deleting a conversation of
questions about a dashboard or a report's run.

- A thread whose dashboard is pinned can't be deleted: unpin it first. A thread whose alert or
  report is active can't either: deactivate it first.
- Editors restore their own threads. Analysts restore the conversations they started or deleted.
- Admins see everything in the bin, restore any of it, and **Delete for good**, one by one or
  with **Empty bin**.
- The bin says, for each thing, when it goes for good.

Deleting for good removes the thread with its dashboard and every version, and the dashboard's
snapshots and questions with it. An alert or a report a thread made is never deleted with it.

## Retention

**Retention**, on the bin, sets how long deleted things stay:

- **For a number of days**: 30 by default. The hourly purge deletes them after that. 0 deletes
  them at the next run.
- **Until someone deletes them**: they stay until an admin deletes them for good.

Report runs are kept for good by default. The Reports page's **Settings** keeps them for a number
of days instead; reports and their versions always stay.

## What else is purged

These go on their own, every hour:

- Snapshots past their lifetime.
- Sessions that ended.
- Notification sends older than 30 days.
- Alert state changes older than 90 days.

## Usage stays

The usage ledger has no tie to threads, so purging never changes **Settings → Usage**. What a
model spent stays counted after the thread that spent it is gone.

## In the configuration file

`retention: { binDays: 30 }` sets the bin's retention from the file; `null` keeps things until
deleted. See [the configuration file](../configuration.md#retention).
