# Evals

The cases the agent is run on, against the dev data, and how each is scored. A model does not
answer the same way twice, so the evals do not pretend it does: they keep cases apart, let code
decide what code can decide, and show how often a case passes when it is run several times.

## One shape for every case

Every case reads the same way, as a unit test does: arrange, act, assert.

```ts
{
  id: 'f06',
  bucket: 'capability',
  given: searchWorld,
  input: { surface: 'dashboard', turns: ['How many events with event_name ERROR were there ...'] },
  checks: [panelCount(1, 4), showsNumber(errorEvents, { relative: 0.005 })],
  rubric: ['...'],
}
```

| Part     | What it is                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| `given`  | A fixture: the world before the case acts. Built by the app's services, with no model.        |
| `input`  | One act on a surface of the product: the person's turns, one to three.                        |
| `checks` | What code asserts about what was made, in the order one needs the other.                      |
| `rubric` | Plain sentences, one claim each, that a judge answers yes or no. Only where code cannot tell. |

Three rules hold for all of them:

- **A case starts in a world of its own.** Each trial opens new services on a new database, runs
  the case's fixture, and acts. No case reads what another case made.
- **Code decides facts. A model judges only meaning.** A number is compared with the data, never
  read by the judge.
- **One failure gives one reason.** A check that others need is a gate: when it fails, the checks
  after it and the judge are skipped.

### Buckets

A case is in one of two buckets, and each has its own headline number.

| Bucket       | The case                                              | A failure means                     |
| ------------ | ----------------------------------------------------- | ----------------------------------- |
| `capability` | Asks exactly, names its fields, has one right outcome | The product cannot do it            |
| `realistic`  | Asks as a person would, takes any reasonable answer   | The agent did not cope with the ask |

Capability should sit near every case passing, so a drop there is a regression. Realistic is how
good the agent is, and moves by itself from run to run.

### Surfaces

| Surface       | What the case acts on                           | Cases                         |
| ------------- | ----------------------------------------------- | ----------------------------- |
| `dashboard`   | A thread that builds a dashboard                | `q1` to `q14`, `f01` to `f33` |
| `answer`      | A question on the Ask tab of a pinned dashboard | `a1`, `a2`, `a4`, `a5`        |
| `explanation` | A panel's explanation                           | `a3`                          |
| `alert`       | A thread that writes an alert                   | `al1` to `al9`                |
| `report`      | A thread that writes a report                   | `r1`, `r2`                    |
| `run-answer`  | Questions about a report's run                  | `r3`, `r4`                    |

Each surface runs its own structure checks before a case's: a dashboard was built, every panel
runs, no query names a fixed date, no two panels run the same query; an answer was given; an alert
or a report was saved, previews, and names only channels it was offered. A case leaves one out
with `without`.

### Checks

| Kind        | It decides                                          | Such as                                                                   |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `structure` | The thing was made and runs                         | `built`, `everyPanelRuns`, `panelCount`                                   |
| `result`    | Its numbers are the ones computed from the dev data | `showsNumber`, `totalsMatch`, `firesOnceOnIncident`, `runMatchesDatabase` |
| `feature`   | It has the feature the case is about                | `shapeView`, `firesAbove`, `quotesNoData`                                 |
| `legacy`    | A pattern over a title, a query or a text           | `topic`, `shapeData`, `mentions`                                          |

A legacy check is what the scoring was before: it passes a dashboard for its words. It stands in
for a rubric or a result check, and counts only while the trial has none. Once a judge reads the
rubric, the patterns it replaces no longer decide. Once a result check ran, the pattern over the
query no longer decides.

### Truths

A result check compares what a panel returned with a truth: a value computed from the dev data on
a path of its own, with plain requests, no connector and no builder (`truth/`). A fault in the
product's query path cannot hide on both sides. A truth is computed at the run's clock, kept with
the trial, and every comparison states its tolerance: a share of the truth, or an amount in its
unit, and the units a right number may be written in.

### Status

| Status   | When                                                                       |
| -------- | -------------------------------------------------------------------------- |
| `error`  | The provider or the harness failed, after one more try. It is in no count. |
| `fail`   | A check that decides failed, or the judge said no.                         |
| `review` | Nothing failed, and the judge was not sure. Listed apart, in no count.     |
| `pass`   | Every check that decides passed, and every sentence is yes.                |

## The judge

A small model reads a case's rubric against what the case made: the turns, the dashboard with
each panel's query and a summary of its result (its rows only when there are few), or the answer
with its reads, or the alert with its replay, or the report with a run's numbers.

- One fixed judge for every run, whichever provider made what it reads, so runs compare. By
  default `anthropic/claude-haiku-4-5`. `--judge-provider google` makes it
  `google/gemini-3.5-flash-lite`, and `--judge-model` picks another model.
- It never sees the provider or the model.
- It answers each sentence apart: yes, no or uncertain, with a reason and the piece it is based
  on. An answer it does not give is uncertain, never a pass.
- It reads a rubric only when no check that decides already failed.
- A verdict is cached under everything it was sent, its model and the version of its
  instructions (`judge/prompt.ts`). Changing a sentence asks again; the same thing is never judged
  twice.
- Its temperature is 0 where the provider takes it. Anthropic does. Google advises leaving its
  models' sampling alone, so there it is left alone.
- It needs a key of its provider in `JUDGE_API_KEY`. Only that turns it on: were a
  run's own key enough, a run on the judge's provider would be judged and a run on another would
  not, and the two would not compare. Without it, or with `--no-judge`, no judge runs and the
  patterns decide. The report says which.

### Calibrate it

A judge is a model too. Before its verdicts are trusted, compare them with yours.

1. `bun run evals --judge <report.json>` reads the rubrics of a saved report, an old one too. It
   writes `<report>.judged.json` and `<report>.labels.json`, one entry per sentence with what the
   judge said.
2. Read the dashboards and answers, set `"label"` to `"yes"` or `"no"` on the entries you checked,
   and move them into `judge/labels.json`.
3. `bun run evals --calibrate <judged.json>...` counts how often the judge agrees with you, in all
   and by the provider that made the thing. A wrong pass (the judge says yes, you say no) is
   counted apart from a wrong failure: it makes the product look better than it is.
4. `--judge <report.json> --twice` reads the report twice and says how often the judge agrees
   with itself.

A label is tied to its sentence: edit the sentence and its labels go stale, and the count says so.
About 30 labels tell a bad judge from a good one, not two good ones from each other. Every review
you settle is a label to add.

## Trials

```sh
bun run evals --only q11 --trials 5
```

A case run five times shows 0/5 (a bug), 5/5 (it works) or 3/5 (noise). The report shows the
fraction, never a percentage: five trials say whether a case is stable, not how often it passes.

- The first trial has the cache key a run without trials has. Each later trial has its own, so
  trials are new samples, and the same trial replays free.
- `--sample <name>` names a sample set: a new name asks for new answers, kept under that name.
- Every trial costs as much as the case. Use `--trials` with `--only`.
- A run with trials writes each case's fraction and day to `unstable.json`, by models. Later runs
  list those cases apart, and `--compare` does not mark their changes. Set `"stable": true` or
  `false` on an entry to settle a case by hand.

## Fixtures

A fixture is the state a case starts from (`fixtures/`): a pinned dashboard, a question already
answered, an alert thread started from a panel, a thread that already wrote an alert or a report,
a report with a run. A follow-up case such as `al3` ("Make it wait 10 minutes instead") starts
from the fixture of a thread that wrote the alert, not from `al1`.

- A fixture is stored through the app's own services and checked by its schemas, so one an app
  change made stale fails when it loads.
- The two recorded threads are files in `fixtures/`. Edit them by hand: a fixture should be
  the right answer, not one sample of it.
- `bun run evals --record alert-checkout-share` runs the case a recording stands for and, when it
  passes, rewrites the file. Read the diff before keeping it.

## The report

A report shows, for each case, its status, its fraction when it had trials, why it did not pass,
each check and each rubric sentence with the judge's reason, the tool calls of the run, and what
it made. At the top:

- the two headline numbers, capability and realistic;
- how far the realistic count moves by itself between two runs of the same code;
- the cases whose trials disagreed, and those earlier trials showed unstable;
- the cases whose run erred, which are in no count;
- the number as scored before rubrics and results, so a jump is explained;
- whether a judge read the rubrics, how many it was asked and for how many tokens.

Reports go to `evals/reports/`, which git ignores: an HTML page, the JSON that `--rescore`,
`--compare`, `--judge` and `--calibrate` read, and `evalmark.json`, the run in
[evalmark](https://github.com/jboix/evalmark)'s result format, with every trial, check and tool
call. A report written before trials still reads: one trial per case, scored as the cases are now.

## The layout mark

Every dashboard a question builds, and every report a report case saves, gets a mark for its
layout. It is read from the saved spec by code (`report/layout-mark.ts`), with the rows of the server's
layout check, so the mark and the advice the agent gets agree on what a gap is. The mark stands
beside the verdict and never changes it: a question passes or fails on what it shows, not on where.

| Part         | It holds when                                                                         |
| ------------ | ------------------------------------------------------------------------------------- |
| No gaps      | No row of the grid leaves columns empty. A tall panel fills the rows it reaches into. |
| First row    | The first row answers the question: the headline numbers are there.                   |
| Side by side | Related panels share a row. It is judged only when two panels are related.            |

The first row of a dashboard:

- holds a number, when the dashboard has numbers;
- holds a number, when the dashboard has three panels or more. One or two panels are the answer
  themselves;
- shows one of the question's topics in a panel's title or query.

The first row of a report is its headline row, above the grid:

- it names a headline number;
- no number is left on the grid;
- it shows one of the case's headline topics.

The grid of a report is read without its headline numbers.

Two panels are related when:

- both are numbers, and the grid has two or more. Each must share a row with another panel: the
  other numbers, or the chart it sums up;
- they run the same queries and neither is a number, such as a chart and a table of one query.
  They must share a row. A number and its trend are not such a pair, since numbers go first.

The report shows the mark in four places:

- The printed table has a cell per question, such as `layout 2/3`: the parts that hold, of those
  judged. `layout -` means nothing was saved, or the report was written before places were kept.
- The Markdown table has a `Layout` column: a tick, or a cross with what the layout misses.
- The HTML page has a line per question with each part, then what the layout misses.
- The table of parity families has a `Layout` column beside `Shape` and `View`.

The run's tally reads `Layout: 5 of 7 read well (no gaps 6 of 7, first row 7 of 7, side by side
5 of 6)`. `--rescore` marks a saved report again. The evalmark result does not hold the mark.

## Run them

```sh
bun run env:up                      # the dev Postgres and Prometheus
bun run env:up:search               # the dev Elasticsearch and OpenSearch, for --search
GEMINI_API_KEY=… bun run evals      # every default case, on Gemini
ANTHROPIC_API_KEY=… bun run evals --provider anthropic   # the same, on Anthropic
GEMINI_API_KEY=… bun run evals --only q3,q7              # only these cases
GEMINI_API_KEY=… bun run evals --only realistic          # only a bucket
GEMINI_API_KEY=… bun run evals --only parity --search    # the parity cases, f01 to f33
GEMINI_API_KEY=… bun run evals --only q11 --trials 5     # one case, five times
```

The dev data tells of an incident yesterday. `bun run env:up` seeds the data again when it was
seeded on an earlier day, and the evals stop with that advice when the data's incident is not
yesterday's.

| Flag                                | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `--only q3,q7`                      | Only these cases. Also a bucket (`realistic`, `capability`) or `parity`.     |
| `--trials <n>`                      | Each case n times. Use with `--only`.                                        |
| `--sample <name>`                   | A named sample set: new answers, kept under that name.                       |
| `--provider <name>`                 | `google` (the default) or `anthropic`, with its key.                         |
| `--model <id>`                      | The model for every job, instead of the provider's suggested pair.           |
| `--build-model <id>`                | Another model for building and repairs.                                      |
| `--search`                          | Adds the dev OpenSearch as the connector `opensearch-events` to every world. |
| `--no-judge`                        | No judge: the patterns that stand in for rubrics decide.                     |
| `--judge-provider`, `--judge-model` | Another judge than the default one.                                          |
| `--no-cache`                        | Asks the provider again, and keeps its answers.                              |
| `--allow-failures <n>`              | Exits with an error when more than n cases fail. Without it, never.          |
| `--rescore <report.json>`           | Scores a report again with the cases as they are now, with no model call.    |
| `--compare <a.json> <b.json>`       | Each case's status and tokens from one report to the next.                   |
| `--judge <report.json>`             | Reads the rubrics of a saved report; `--twice` reads them twice.             |
| `--calibrate <judged.json>...`      | How far the judge agrees with `judge/labels.json`.                           |
| `--record <fixture>`                | Records a fixture again from a live run of its case.                         |

Without `--model`, a run uses the models quanthea suggests for the provider, split by job as its
presets split them: on Google, `gemini-3.5-flash-lite` talks, writes titles and answers, and
`gemini-3.8-flash` builds and repairs; on Anthropic, `claude-haiku-4-5` and `claude-sonnet-5`.

A case that needs what the world lacks is skipped and reported as skipped, never as a failure:
the parity cases and `a5` need `--search`, and three parity cases need an HTTP connector or a
pinned dashboard to link to, which no world has yet. The parity cases cost more than the others,
so a run takes them only when `--only` names them.

### The search connector

Without `--search`, a world holds two connectors: `postgres-orders` and `prometheus-dev`. With it,
every world also holds `opensearch-events`, the dev OpenSearch, whose index `core_events` holds the
events of a media player.

- Start the server first with `bun run env:up:search`.
- The run waits until the server answers and `core_events` holds events of today. It stops with
  that advice when the index was seeded on an earlier day.
- Every prompt lists the connectors. A run with the flag therefore shares no cached response with
  a run without it, so the flag is off unless asked for.

## Spend little

- **The cache.** Each model response is kept in `evals/.cache`, under a hash of the model, its
  settings and the whole request. The clock is fixed at 10:00 UTC for the day, so a day's reruns
  repeat the same requests. Ids a run makes anew, the channel's and a pinned dashboard's, are kept
  as stable aliases. Requests that follow a query's results can change when live data changes.
- **Scoring needs no model.** Change a check, then `--rescore` the last report. The judge's
  verdicts stay, for the sentences that stay.
- **One failure at a time.** `--only q3` runs one case.
- **Trials only on what you work on.** `--trials 5` on the full set is five full sets.
- **The judge is cheap and capped.** It reads only the rubrics of cases no check failed, caches
  every verdict, and stops after 300 calls in a run. The report says what it spent.
- **The full set only when prompts or models change**, not routinely.

Live calls are spaced 4 seconds apart, to stay under the free tier's limit per minute.

## In GitHub Actions

The Evals workflow runs by hand only: Actions, Evals, Run workflow, on `main`, picking the provider:
`google`, `anthropic`, or `both`, one job each. Ticking `search` also starts the dev Elasticsearch
and OpenSearch and runs with `--search`. `trials` runs each question that many times (1 by
default), as `--trials`: name the questions in `only` too, since every trial costs as much as the
question. Its jobs run for the repository's owner alone, in
the `evals` environment, which holds `GEMINI_API_KEY` and `ANTHROPIC_API_KEY`. Picking `judge`
sets who reads the rubrics: `anthropic` (the default) or `google`, with that provider's key, or
`none`. Each job gets its own provider's key and the judge's, so one judge reads both jobs. A job starts the dev data sources, runs the cases with the provider's
suggested models, and keeps the cache between runs. The summary table shows on the run's page; the
HTML report and the JSON are the `evals-report-<provider>` artifact. A job fails only when the run
breaks, never because cases fail.

Each job then records its run with evalmark on the `evalmark` branch, failing cases included,
labelled with the provider and its models. The branch keeps every run since, and its dashboard
shows each case over time, provider by provider. Once the jobs end, the workflow deploys the
website again, which copies that dashboard to [quanthea.ch/evals](https://quanthea.ch/evals/). To
look at it from a clone instead:

```sh
git fetch origin evalmark
npx evalmark preview   # the evalmark branch's dashboard, on http://127.0.0.1:4400
```

## Add a case

1. Pick its bucket. If the ask has one right outcome, it is a capability case: name the fields,
   and check the result against a truth. If a person would ask it this way and several answers are
   fine, it is a realistic case: write a rubric.
2. Pick its fixture, or write one in `fixtures/fixtures.ts`. Never start from another case.
3. List its checks, most needed first. A check is one assertion: take one from `checks/`, or add
   one there with its own test.
4. Write the rubric as sentences of one claim each, that the dashboard or the answer can show.
   A sentence that needs a number to be right is not a rubric sentence: it is a result check.

For a dashboard case that asks for one panel of a known shape, `shapeData` and `shapeView` take
the shape. Every part given must hold on the same panel, and the fault names each missing part on
the panel that comes closest.

| Field          | What it expects                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| `builder`      | The data kind the agent asked the edit tool for: a builder's name, `raw` or `saved`.         |
| `aggregations` | Aggregations in the search body: a type such as `date_histogram`, or `terms:event_name`.     |
| `operations`   | The names of the panel's table operations, in order. The panel may have others between them. |
| `view.kind`    | The view's kind.                                                                             |
| `view.recipe`  | The chart recipe the agent asked for.                                                        |
| `view.has`     | Fields the view must hold, as paths such as `sort.field`.                                    |

## Where things are

| Folder      | What it holds                                                                   |
| ----------- | ------------------------------------------------------------------------------- |
| `core/`     | The case shape, a trial's result, the status rules, the runner, the selection.  |
| `cases/`    | The cases, by surface, and the parity cases with their families.                |
| `fixtures/` | The fixtures, the recorded threads and the command that records them.           |
| `surfaces/` | How each surface acts, and what it keeps of what was made.                      |
| `checks/`   | The checks of each surface, and the result checks.                              |
| `truth/`    | The truths, computed on the dev sources directly.                               |
| `judge/`    | The judge, what it reads, its instructions, and its calibration.                |
| `report/`   | The report, its pages, the evalmark result, the layout mark, the unstable book. |
| `world/`    | The world a trial runs in, the response cache, the providers.                   |
