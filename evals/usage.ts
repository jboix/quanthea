/** What `bun run evals --help` prints. */
export const usage = `Runs the eval cases against the dev data, and scores what the agent makes.

Every case has the same shape: a fixture (given), one act on a surface of the product (input),
checks decided by code, and a rubric a judge reads. A case starts in a world of its own.

  bun run evals                         every default case, on Gemini: gemini-3.5-flash-lite
                                        talks, gemini-3.8-flash builds
  bun run evals --provider anthropic    on Anthropic: claude-haiku-4-5 talks, claude-sonnet-5 builds
  bun run evals --only q3,q7            only these cases
  bun run evals --only realistic        only the cases of a bucket: realistic or capability
  bun run evals --only parity --search  the parity cases (f01 to f33), one per family of panels
                                        on the player events; or --only f05,f11
  bun run evals --only q3 --trials 5    each case five times: 0/5 is a bug, 3/5 is noise
  bun run evals --only q3 --trials 5 --sample monday
                                        a named sample set: new answers, kept under that name
  bun run evals --model gemini-3.8-flash
  bun run evals --build-model gemini-3.8-flash   another model for building and repairs
  bun run evals --search                with the dev OpenSearch as a third connector
  bun run evals --no-judge              no judge: the patterns that stand in for rubrics decide
  bun run evals --judge-provider google --judge-model gemini-3.8-flash
  bun run evals --no-cache              ask the provider again, and keep its answers
  bun run evals --allow-failures 2      exit with an error when more than 2 cases fail
  bun run evals --rescore <report.json> score a report again, with no model call
  bun run evals --compare <a.json> <b.json>
  bun run evals --judge <report.json>   read the rubrics of a saved report, to calibrate the judge
  bun run evals --judge <report.json> --twice   and again, to see how far the judge agrees with itself
  bun run evals --calibrate <judged.json>...    how far the judge agrees with evals/judge/labels.json
  bun run evals --record alert-checkout-share   run the case a fixture is recorded from, and
                                                rewrite the fixture's file: review the diff

It needs the data sources (bun run env:up, and bun run env:up:search with --search) and the
provider's key, GEMINI_API_KEY or ANTHROPIC_API_KEY, except for the responses the cache in
evals/.cache already holds. A run with --search lists one connector more in every prompt, so it
shares no cached response with a run without it. The judge needs a key of its own, of its own
provider (Anthropic by default): JUDGE_API_KEY. Without it, no judge runs.

Trials: the first trial of a case has the cache key a run without trials has, and each later
trial has its own, so trials are new samples and the same trial replays free. Use --trials with
--only: every trial costs as much as the case.

Reports go to evals/reports, as JSON and as an HTML page; in GitHub Actions the summary also goes
to the job's summary page. A run that ends in an error (the provider, or the harness) is tried
once more, then counted in no fraction. It exits with an error when more cases fail than
--allow-failures allows; without it, failing cases are reported, never an error. A case that needs
what the world lacks, such as the search connector without --search, is skipped and reported as
skipped.
`;
