# Evals

The questions the agent answers against the dev data, each with what a good answer holds. A run
asks each question as a person would: it answers the agent's question with its first option,
approves the plan, and lets the build run. Then it scores what was built:

- a dashboard was built, with a number of panels in the expected range;
- every expected topic shows in a panel's title or query, and every expected connector is queried;
- no query of the last version fails when run again;
- the build took no more failed writes than allowed.

The report adds the tokens, the cost at list price and the time of each question.

Running the evals calls a model, so they are never part of `bun run verify`. The scoring has unit
tests, which call none.

## Run them

```sh
bun run env:up                      # the dev Postgres and Prometheus
GEMINI_API_KEY=… bun run evals      # every question, on gemini-3.5-flash-lite
```

The dev data tells of an incident yesterday, as of when `env:up` seeded it. When the data sources
were seeded on another day, seed them again: `bun run env:down && bun run env:up`.

| Flag                          | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `--only q3,q7`                | Asks only these questions, to work on one failure.                            |
| `--model <id>`                | The model for every job. `gemini-3.5-flash-lite` by default.                  |
| `--build-model <id>`          | Another model for building and repairs, such as `gemini-3.8-flash`.           |
| `--no-cache`                  | Asks the provider again, and keeps its answers.                               |
| `--rescore <report.json>`     | Scores a report again with the questions as they are now, with no model call. |
| `--compare <a.json> <b.json>` | Each question's verdict and tokens from one report to the next.               |

Reports go to `evals/reports/`, which git ignores.

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
the dev data sources, asks the questions with the models given, keeps the cache between runs,
and uploads the report as the `evals-report` artifact.

## Add a question

Add it to `questions.ts`, with what a good answer holds: the connectors it queries, the range of
panels, the topics that must show, and the failed writes it may take. Write the topics as
patterns over the panels' titles and queries.
