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

| Case | What it asks                                                       | A good answer                                                                                                       |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `a1` | "What happened around 14:00?" (13:00 in winter), at aggregates (3) | reads data, cites at least one read, mentions the errors and the deploy, and states a time range ("14:02 to 14:38") |
| `a2` | the same question, at schema and metadata (2) only                 | reads nothing, says it cannot read the numbers, and quotes no data                                                  |
| `a3` | the explanation of "Error rate by service, 1m"                     | reads nothing (at level 3 still), mentions the rate, the 5xx errors and the requests, quotes no data, cites nothing |
| `a4` | "How long did it last?", following up on `a1`                      | gives a duration, such as "36 minutes"                                                                              |

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

## Run them

```sh
bun run env:up                      # the dev Postgres and Prometheus
GEMINI_API_KEY=… bun run evals      # every question and answer case, on gemini-3.5-flash-lite
GEMINI_API_KEY=… bun run evals --only a1,a2,a3,a4   # the answer cases only
```

The dev data tells of an incident yesterday. `bun run env:up` seeds the data again when it was
seeded on an earlier day, and the evals stop with that advice when the data's incident is not
yesterday's.

| Flag                          | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `--only q3,q7`                | Asks only these questions or answer cases, to work on one failure.            |
| `--model <id>`                | The model for every job. `gemini-3.5-flash-lite` by default.                  |
| `--build-model <id>`          | Another model for building and repairs, such as `gemini-3.8-flash`.           |
| `--no-cache`                  | Asks the provider again, and keeps its answers.                               |
| `--allow-failures <n>`        | Exits with success when at most n questions fail. 0 by default.               |
| `--rescore <report.json>`     | Scores a report again with the questions as they are now, with no model call. |
| `--compare <a.json> <b.json>` | Each question's verdict and tokens from one report to the next.               |

Reports go to `evals/reports/`, which git ignores: an HTML page to read, with each question's
verdict and why, what the agent asked or said last, and each panel with its query (for an answer
case, the answer's text and each read with what it returned); and the JSON
that `--rescore` and `--compare` read. The command exits with an error when more questions fail
than `--allow-failures` allows, none by default.

## Spend little

- **The cache.** Each model response is kept in `evals/.cache`, under a hash of the model and the
  whole request, and replayed when the same request comes again. The clock is fixed at 10:00 UTC
  for the day, so a day's reruns repeat the same requests. Requests that follow a query's
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
