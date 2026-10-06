# Reports

A report runs a set of panels on a schedule, over a period, and sends the result: "every Monday
at 8:00, last week's sales, compared with the week before". The agent writes it once in a
conversation. Each run is computed by quanthea with no model, and frozen.

Editors write and activate reports. Every role reads them and their runs.

## Write one

Open **Threads**, pick **A report**, and say when it runs, what it covers and who hears:

> Every Monday at 8:00, last week's sales: revenue, orders, average basket and the 5 best-selling
> products, compared with the week before. Link the sales overview.

The agent proposes a plan: **Runs**, **Covers**, **Compares**, **Shows**, **See also** (pinned
dashboards it links to) and **Sends to** (the channels). Approve it, and the report appears in the
draft pane, run once over its latest period.

![A report thread: the plan, and the draft previewed on last week with its headline numbers](../screenshots/report-thread-light.webp#gh-light-mode-only)
![A report thread: the plan, and the draft previewed on last week with its headline numbers](../screenshots/report-thread-dark.webp#gh-dark-mode-only)

## The draft

- **The schedule as a sentence**: "Every Monday at 08:00 Europe/Zurich, covering the previous
  week, compared with the week before. Next run Mon 13 Oct, 08:00." Click any value to change it:
  the day, the time, the time zone, the period or the comparison.
- **The preview** runs the latest version over its latest period. The headline numbers come
  first, each with its change and the value before (`▲ 6.2% · was CHF 173,560`); the other panels
  follow.
- **See also** and **Sends to** list the linked dashboards and the channels.
- **Send a test now** sends the message to its channels, marked as a test.
- **Activate** schedules it. Activating runs its queries once, and refuses one that fails.

### Schedules and periods

A report runs every day, every week on a weekday, or every month on a day, at a time on its time
zone's clock. Daylight saving moves the instant, never the local time. A monthly report on the
31st runs on the last day of shorter months.

| Period             | Covers                                     |
| ------------------ | ------------------------------------------ |
| The previous day   | yesterday, midnight to midnight            |
| The previous week  | Monday to Sunday (ISO weeks)               |
| The previous month | the calendar month                         |
| This week so far   | from Monday's midnight to the time it runs |

The comparison runs every panel over the period before as well, so each headline number shows its
change.

## The reports list

![The reports list: each report with its schedule, its latest headline number and a bar history of its runs](../screenshots/reports-light.webp#gh-light-mode-only)
![The reports list: each report with its schedule, its latest headline number and a bar history of its runs](../screenshots/reports-dark.webp#gh-dark-mode-only)

**Reports** lists each report with its schedule (`Mondays 08:00 · the previous week`), its latest
headline number with its change, a small history of that number over the last runs, and the next
run. A dot marks a report with a run you have not opened, and the rail's Reports carries one too.

## A run

![A report's run: the period as the title, the headline numbers with their change, then the panels](../screenshots/report-run-light.webp#gh-light-mode-only)
![A report's run: the period as the title, the headline numbers with their change, then the panels](../screenshots/report-run-dark.webp#gh-dark-mode-only)

A run's page shows the period as its title (`Week 39 · 21 – 27 Sep`), when it ran and where it
was sent, then the headline numbers and the panels. Opening it runs no query: the results were
frozen when it ran.

- **‹** and **›** step to the runs before and after.
- **See also** opens each linked dashboard on the run's period.
- **Ask about this** asks questions about the run; see
  [Ask about a report's run](ask-and-explain.md#ask-about-a-reports-run).
- **Change** (editors): **Edit with the agent**, **Run now** (runs it over its latest period, and
  sends it only when you ask), **Deactivate** or **Activate**.
- **Share → Copy link**, and **Versions** for editors.

## When a run fails

A run that fails tries again, 2 times by default, 15 minutes apart. Past that it is marked failed
with its reason, and its channels hear so, when the alert setting **Notify when an alert cannot be
checked or a report fails** is on. After downtime, a report runs once for the latest missed
period, never a backlog.

## Settings

Admins open **Settings** on the Reports page:

- **Retries** and **the delay between them**, from a minute to a day.
- **How long runs are kept**: for good (the default) or a number of days. Reports and their
  versions always stay.

Messages go to the channels admins set up in [Notifications](notifications.md). Each message
carries the period, the headline numbers with their change, a link to the run and links to the
dashboards.
