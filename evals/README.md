# Evals

The questions the agent answers against the dev data, each with what a good answer holds. A run
asks each question as a person would: it answers the agent's question with the question's scripted
answer, or else its first option, approves the plan, and lets the build run. A question the agent
asks in prose before any plan gets the scripted answer, or "go ahead". Then it scores what
was built:

- a dashboard was built, with a number of panels in the expected range;
- every expected topic shows in a panel's title or query, or in a marker set's label or query, and
  every expected connector is queried;
- when the answer needs markers, the charts carry a marker set, and the marker sets show every
  expected marker topic and query every expected marker connector;
- no query of the last version fails when run again;
- no query names a fixed date or the current time instead of following the time range;
- no two panels run the same query;
- the build took no more failed writes than allowed.

The report adds the tokens, the cost at list price and the time of each question.

## Answer cases

After the questions, the answer cases (`a1` to `a4`, in `answer-cases.ts`) ask the dashboard
answering service, the one behind a pinned dashboard's Ask tab and a panel's explanation. The run
creates the dev seed's checkout incident dashboard (`dev/seed/checkout-incident.json`) and pins
it. Each case sets the access level of both dev connectors, then makes one call to the service,
prepared and stored as the question and explanation endpoints do. The range asked about is
yesterday from 06:00 to 18:00 UTC, relative to the run's clock, so no date is written down.

| Case | What it asks                                                       | A good answer                                                                                                                 |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `a1` | "What happened around 14:00?" (13:00 in winter), at aggregates (3) | reads data, cites at least one read, mentions the errors and the deploy, and names two times (a range, or a start and a peak) |
| `a2` | the same question, at schema and metadata (2) only                 | reads nothing, says it cannot read the numbers, and quotes no data                                                            |
| `a3` | the explanation of "Error rate by service, 1m"                     | reads nothing (at level 3 still), mentions the rate, the 5xx errors and the requests, quotes no data, cites nothing           |
| `a4` | "How long did it last?", following up on `a1`                      | gives a duration, such as "36 minutes"                                                                                        |

Every case also needs the service's outcome to be ok: an answer whose citations the server
checked. A read is a `read_data` call, counted from the stream the service writes. `a4` asks `a1`
first when `--only` leaves `a1` out; that call is not reported.

"Quotes no data" is a heuristic over the text. Clock times, dates, years and citation markers are
removed first. Then a number reads as a measurement when it is:

- a percentage, such as `8.4%` or `3 percent`;
- a decimal, such as `2.9` or `0.084`;
- a count of four digits or more, such as `1,240` or `15000`;
- a number followed by orders, requests, errors, failures or deploys, such as `42 errors`.

Numbers inside a word (`5xx`, `p95`, `[1m]`) never match. The heuristic misses a bare small count,
and would flag a decimal constant of a query, such as the `0.95` of a quantile.

Each case is one service call of a few model steps (a read or two, then the answer), on the
`answer` model job. A dashboard question takes several runs of planning and building, so the four
cases add little to a full run, and the cache replays them on a day's reruns. Run only them with
`--only a1,a2,a3,a4`. To add one, add it to `answer-cases.ts` with its access level and what a
good answer holds.

Running the evals calls a model, so they are never part of `bun run verify`. The scoring has unit
tests, which call none.

## Alert cases

Then the alert cases (`al1` to `al4`, in `alert-cases.ts`) drive alert threads through the agent,
wired as the chat endpoint wires them. A case sets the access level of both dev connectors, asks,
answers the agent's question with its scripted answer, approves the alert plan, and lets the agent
write. The world holds one notification channel, a webhook to a closed local port; nothing sends
to it, since the evaluator does not run and no test is asked for. Then the run reads the alert's
latest version and replays it over the day before the run's clock, which holds the incident,
through the alerts service rather than the model.

| Case  | What the person says                                                                 | A good alert                                                                                  |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `al1` | "Tell me when checkout's 5xx share stays above 2% for 5 minutes.", at aggregates (3) | on `prometheus-dev`, above 2% for 5m, and its replay fires once for checkout after the deploy |
| `al2` | the same, at schema and metadata (2) only                                            | the same alert, no `replay_alert` call, and the agent says it cannot replay the numbers       |
| `al3` | "Make it wait 10 minutes instead.", following up on `al1`                            | a new version, above 2% for 10m, and its replay still fires once for checkout                 |
| `al4` | "Alert me when this goes above 3%.", from the panel `error-rate-by-service`          | above 3%, the panel's query (same fingerprint), and a `from_panel` link to the panel          |

Every case also needs:

- the threshold as a ratio (`0.02`), or in percent (`2`) when the query multiplies by 100;
- one series per service, or a query that keeps to checkout;
- a message that uses only the known placeholders and names `{alert}` or `{value}`;
- channels from the list only.

Checkout fires "once after the deploy" when its series has exactly one firing period over the
replay, starting at most 20 minutes after 12:02 UTC. Its error share passes 2% about 3 minutes into
the incident and stays above for about 29, so a wait of 5 or 10 minutes fires once. Payments
passes 2% too, for about 16 minutes, and may fire; only checkout is scored. `al3` runs `al1` first
when `--only` leaves `al1` out; that run is not reported. `al4` starts from the pinned checkout
incident dashboard of the answer cases.

Each case is one or two runs of the agent: the plan, then the write after the approval. A run is a
handful of model steps: a `describe` or two, the plan, `edit_alert`, the replay. `al3` changes the
draft in one run. A case costs less than a dashboard question, which plans and builds several
panels. Run only them with
`--only al1,al2,al3,al4`. The report shows each alert's condition in words, its query, the replay
over yesterday by series, the tools the agent called and what it said.

## Report cases

Last, the report cases (`r1` to `r4`, in `report-cases.ts`). `r1` and `r2` drive a report thread
through the agent, wired as the chat endpoint wires it, with the same channel and the checkout
incident dashboard pinned. `r3` and `r4` ask about the run `r1` made, through the answering
service, prepared and stored as the endpoint of questions about a run does. The dev Postgres holds
an order attempt per second from yesterday 04:02 UTC to the time it was seeded, so yesterday is
the one day with data, and the cases report on it.

| Case | What the person says                                                                                                      | A good outcome                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `r1` | "Every morning at 7:00, yesterday's orders: how many, revenue, and failed orders, compared with the day before.", level 3 | a daily report at 07:00 in Europe/Zurich over the day before, and a run whose numbers match the SQL |
| `r2` | "Make it weekly on Mondays, covering the previous week.", following up on `r1`                                            | a new version, every Monday at 07:00 in Europe/Zurich, over the week before                         |
| `r3` | "What stood out yesterday?", then "What should we keep an eye on?", on `r1`'s run, at aggregates (3)                      | cites a frozen read and names the failures and the incident; then 1 to 3 follow-up cards            |
| `r4` | "What stood out yesterday?", on `r1`'s run, at schema and metadata (2) only                                               | says it cannot read the numbers, and quotes no data                                                 |

`r1` and `r2` also need:

- the comparison with the period before;
- headline panels whose titles or queries show the orders and the revenue;
- every panel's query on `postgres-orders`;
- the latest version's preview over its latest period, with every query run;
- channels from the list only.

After `r1`, the evals run the saved version through the reports service (Run now, at the evals'
clock, so over yesterday on Zurich's clock). Then they count that period's orders on the
dev Postgres directly, as the read-only role, both ends kept, as a report's query does. Each
headline is matched by its title:

- the orders: between the paid orders and every attempt, so the agent may count either;
- the revenue: between the paid orders' total and every attempt's, in cents or in francs, with 2%
  slack for refunds taken off;
- the failed orders, when there is such a headline: their count, or their share of every attempt
  as a ratio or in percent, within 2%.

The run must succeed and hold a headline for the orders and one for the revenue. `r3` and `r4` run
`r1` first when `--only` leaves it out, and `r2` talks `r1` through first; those are not reported.
`r3`'s second question follows up in the same conversation. A frozen read is a `read_run` call;
"the incident" is any of incident, outage, deploy or spike, or a clock time within an hour of the
incident's hour in Zurich. "Cannot read the numbers" also takes "not their numbers" and "the
shape", as the instructions of a run without readable sources word it.

`r1` costs about a dashboard question: a plan, then a build of a few panels, each test-run. `r2`
changes the draft in one run. `r3` is two answering calls of a few steps each, and `r4` one, so the
four cost about two dashboard questions. Run only them with `--only r1,r2,r3,r4`. The report shows
the schedule in words, the period, the headline panels, the preview, the run's headline numbers
beside the database's, the tools and what the agent said; for `r3` and `r4`, each answer with its
reads, frozen or not, and its follow-up cards.

## Run them

```sh
bun run env:up                      # the dev Postgres and Prometheus
GEMINI_API_KEY=… bun run evals      # every question and case, on gemini-3.5-flash-lite
GEMINI_API_KEY=… bun run evals --only a1,a2,a3,a4   # the answer cases only
GEMINI_API_KEY=… bun run evals --only al1,al2,al3,al4   # the alert cases only
GEMINI_API_KEY=… bun run evals --only r1,r2,r3,r4   # the report cases only
```

The dev data tells of an incident yesterday. `bun run env:up` seeds the data again when it was
seeded on an earlier day, and the evals stop with that advice when the data's incident is not
yesterday's.

| Flag                          | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `--only q3,q7`                | Asks only these questions or cases, to work on one failure.                   |
| `--model <id>`                | The model for every job. `gemini-3.5-flash-lite` by default.                  |
| `--build-model <id>`          | Another model for building and repairs, such as `gemini-3.8-flash`.           |
| `--no-cache`                  | Asks the provider again, and keeps its answers.                               |
| `--allow-failures <n>`        | Exits with success when at most n questions fail. 0 by default.               |
| `--rescore <report.json>`     | Scores a report again with the questions as they are now, with no model call. |
| `--compare <a.json> <b.json>` | Each question's verdict and tokens from one report to the next.               |

Reports go to `evals/reports/`, which git ignores: an HTML page to read, with each question's
verdict and why, what the agent asked or said last, and each panel with its query (for an answer
case, the answer's text and each read with what it returned; for an alert case, the condition,
the replay and the tools; for a report case, the schedule, the period, the run's numbers and the
follow-up cards); and the JSON
that `--rescore` and `--compare` read. The command exits with an error when more questions fail
than `--allow-failures` allows, none by default.

## Spend little

- **The cache.** Each model response is kept in `evals/.cache`, under a hash of the model and the
  whole request, and replayed when the same request comes again. The clock is fixed at 10:00 UTC
  for the day, so a day's reruns repeat the same requests. Ids a run makes anew, the channel's and
  the pinned dashboard's, are kept as stable aliases, so a prompt that names them still matches. Requests that follow a query's
  results can change when live data changes, and call the provider again.
- **Scoring needs no model.** Change the expectations, then `--rescore` the last report.
- **One failure at a time.** `--only q3` asks one question.
- **The full set only when prompts or models change**, not routinely.
- **A small set.** Stay at 10 to 15 questions. Add one only when a failure surprises you, and grow
  toward 50 only when you are about to compare models.

Live calls are spaced 4 seconds apart, to stay under the free tier's limit per minute.

## In GitHub Actions

The Evals workflow runs by hand only: Actions, Evals, Run workflow, on `main`. Its job runs for
the repository's owner alone, since it spends the quota of the `GEMINI_API_KEY` secret. It starts
the dev data sources, asks the questions with the models given, and keeps the cache between
runs. The summary table shows on the run's page; the HTML report and the JSON are the
`evals-report` artifact. The job fails when more questions fail than its `allowed-failures`
input allows.

## Add a question

Add it to `questions.ts`, with what a good answer holds: the connectors it queries, the range of
panels, the topics that must show, and the failed writes it may take. Write the topics as
patterns over the panels' titles and queries.

When a good answer marks events on its charts, such as deploys, add `markers` with their own
topics and connectors. Each annotation of the dashboard is a marker set; the topics match a set's
label or query. A run without markers then fails with "no markers on the charts".
