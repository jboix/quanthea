/**
 * What the judge reads for a case: what the person asked, and what the assistant made, written
 * out by surface. It never names the provider or the model. Results are summaries, with their
 * rows only when there are few, and every cut is said.
 */
import { type AlertCaseOutcome, conditionWords, isAlert } from '../checks/alert.ts';
import { type AnswerCaseOutcome, isAnswer, type ReadSummary } from '../checks/answer.ts';
import type { BuiltPanel, Outcome } from '../checks/dashboard.ts';
import { isReport, type ReportCaseOutcome } from '../checks/report.ts';
import { isRunAnswer, type RunAnswerCaseOutcome } from '../checks/run-answer.ts';
import type { EvalCase, Evidence } from '../core/case.ts';
import type { ColumnSummary, PanelResult, QuerySummary } from '../surfaces/panel-results.ts';
import { queriesOf, writtenQuery } from '../surfaces/query-text.ts';

/** How much of a query the judge reads. */
const queryChars = 700;

/** A result with at most this many rows is shown row by row. */
const fewRows = 12;

/** How much the judge reads in all. */
const materialChars = 14_000;

/**
 * A text cut to a length, saying so.
 *
 * @param text - The text.
 * @param length - The most characters.
 * @returns The text, or its start and a note.
 */
function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)} [cut]` : text;
}

/**
 * A column, in words: its name and type, and for a number column its range and total.
 *
 * @param column - The column.
 * @returns The words.
 */
function columnWords(column: ColumnSummary): string {
  if (column.type !== 'number' || column.count === undefined || column.count === 0)
    return `${column.name} (${column.type})`;
  const at = column.maxAt === undefined ? '' : ` at ${new Date(column.maxAt).toISOString()}`;
  return `${column.name} (number: min ${column.min}, max ${column.max}${at}, sum ${column.sum})`;
}

/**
 * One query's result, in lines.
 *
 * @param result - The result.
 * @returns The lines.
 */
function resultLines(result: QuerySummary): string[] {
  if (result.error) return [`  it failed: ${result.error}`];
  if (result.rowCount === 0) return ['  returned: no rows (empty)'];
  const lines = [
    `  returned: ${result.rowCount} rows; columns: ${result.columns.map(columnWords).join(', ')}`,
  ];
  if (result.totals) lines.push(`  totals: ${JSON.stringify(result.totals)}`);
  if (result.rowCount <= fewRows) lines.push(`  rows: ${JSON.stringify(result.rows)}`);
  else lines.push('  rows: not shown');
  return lines;
}

/**
 * A panel's view, in words: its kind, and its recipe for a chart.
 *
 * @param panel - The panel.
 * @returns Such as `chart, trend.line`.
 */
function viewWords(panel: BuiltPanel): string {
  const recipe = panel.view?.kind === 'chart' ? panel.view.recipe?.id : undefined;
  return [panel.kind ?? 'panel', recipe ?? panel.recipe].filter(Boolean).join(', ');
}

/**
 * A panel, in lines: its title and view, each query, and what each returned.
 *
 * @param panel - The panel.
 * @param result - What it returned, if it was kept.
 * @returns The lines.
 */
function panelLines(panel: BuiltPanel, result: PanelResult | undefined): string[] {
  const queries = queriesOf(panel).flatMap((query, index) => [
    `  query on ${query.connector} (${query.language}): ${cut(query.text, queryChars)}`,
    ...(result?.queries[index] ? resultLines(result.queries[index]) : []),
  ]);
  const shown = result?.shown === undefined ? [] : [`  the number it shows: ${result.shown}`];
  return [`Panel “${panel.title}” (${viewWords(panel)})`, ...queries, ...shown];
}

/**
 * A built dashboard, in lines.
 *
 * @param outcome - What was built.
 * @returns The lines.
 */
function dashboardLines(outcome: Outcome): string[] {
  if (!outcome.built) return ['No dashboard was built.', outcome.lastWords ?? ''];
  const results = new Map((outcome.results ?? []).map((each) => [each.panelId, each]));
  const time = (outcome.dashboard as { time?: unknown } | undefined)?.time;
  return [
    `A dashboard with ${outcome.panels.length} panels, over ${JSON.stringify(time ?? 'its range')}.`,
    ...outcome.panels.flatMap((panel) => panelLines(panel, results.get(panel.id))),
    ...(outcome.markers ?? []).flatMap((marker) => panelLines(marker, undefined)),
  ];
}

/**
 * The reads of an answer, in lines.
 *
 * @param reads - The reads.
 * @returns The lines.
 */
function readLines(reads: readonly ReadSummary[]): string[] {
  return reads.map((read) => {
    const panel = read.panelId === undefined ? '' : ` (panel ${read.panelId})`;
    return `  read ${read.id} on ${read.connector}${panel}, ${read.time.from} to ${read.time.to}: ${read.result}`;
  });
}

/**
 * An answer or an explanation, in lines: its text, what it read and what it cites.
 *
 * @param outcome - What the service gave.
 * @returns The lines.
 */
function answerLines(outcome: AnswerCaseOutcome): string[] {
  if (!outcome.ok || outcome.text === undefined)
    return [`No answer was given: ${outcome.message ?? 'no reason'}`];
  const cited = outcome.citations.map((each) => `[${each.n}] is ${each.evidenceId ?? 'no read'}`);
  return [
    `The assistant answered: ${outcome.text}`,
    ...readLines(outcome.evidence),
    ...(cited.length > 0 ? [`  citations: ${cited.join(', ')}`] : []),
  ];
}

/**
 * The answers about a report's run, in lines.
 *
 * @param outcome - What the service gave.
 * @returns The lines.
 */
function runAnswerLines(outcome: RunAnswerCaseOutcome): string[] {
  return outcome.answers.flatMap((answer, index) => [
    `Answer ${index + 1}, to “${answer.question}”: ${answer.text ?? `none: ${answer.message}`}`,
    ...readLines(answer.evidence),
    ...answer.followUps.map((card) => `  follow-up card: ${card.prompt}`),
  ]);
}

/**
 * An alert a thread wrote, in lines: its condition, its query, its replay and what was said.
 *
 * @param outcome - What the case gave.
 * @returns The lines.
 */
function alertLines(outcome: AlertCaseOutcome): string[] {
  const { spec, replay } = outcome;
  if (!spec) return ['No alert was saved.', `The assistant said: ${outcome.said}`];
  const fired =
    replay?.replayable === true
      ? replay.series.map((each) => `${JSON.stringify(each.labels)} fired ${each.firing.length}x`)
      : [`not replayed: ${replay?.replayable === false ? replay.reason : 'no replay'}`];
  return [
    `An alert “${spec.title}”: ${conditionWords(spec)}.`,
    `  query: ${cut(writtenQuery(spec.query).text, queryChars)}`,
    `  replayed over yesterday: ${fired.join('; ')}`,
    `The assistant said: ${outcome.said}`,
  ];
}

/**
 * A report a thread wrote, in lines: when it runs, what it covers, its panels and a run's numbers.
 *
 * @param outcome - What the case gave.
 * @returns The lines.
 */
function reportLines(outcome: ReportCaseOutcome): string[] {
  const { spec, run } = outcome;
  if (!spec) return ['No report was saved.', `The assistant said: ${outcome.said}`];
  const panels = spec.panels.flatMap((panel) => [
    `Panel “${panel.title}”${spec.summaryPanels.includes(panel.id) ? ' (headline)' : ''}`,
    ...panel.queries.map((query) => `  query: ${cut(writtenQuery(query).text, queryChars)}`),
  ]);
  const numbers = (run?.headlines ?? []).map((each) => `  ${each.title}: ${each.text}`);
  return [
    `A report “${spec.title}”: runs ${JSON.stringify(spec.schedule)}, covers ${spec.period}, compares with ${spec.compare}.`,
    ...panels,
    ...(numbers.length > 0 ? ['A run of it gave:', ...numbers] : []),
    `The assistant said: ${outcome.said}`,
  ];
}

/**
 * What a case made, in lines, by its surface.
 *
 * @param evidence - What the case made.
 * @returns The lines.
 */
function madeLines(evidence: Evidence): string[] {
  if (isRunAnswer(evidence)) return runAnswerLines(evidence);
  if (isAlert(evidence)) return alertLines(evidence);
  if (isReport(evidence)) return reportLines(evidence);
  return isAnswer(evidence) ? answerLines(evidence) : dashboardLines(evidence);
}

/**
 * What a person asked, in lines.
 *
 * @param evalCase - The case.
 * @returns The lines.
 */
function askedLines(evalCase: EvalCase): string[] {
  const { input } = evalCase;
  if (input.surface === 'explanation') return [`They opened the explanation of ${input.panel}.`];
  const reply =
    'reply' in input && input.reply ? [`When asked back, they said: ${input.reply}`] : [];
  return [...input.turns.map((turn, index) => `${index + 1}. ${turn}`), ...reply];
}

/**
 * What the judge reads for a case.
 *
 * @param evalCase - The case.
 * @param evidence - What it made.
 * @returns The text, cut to a length with a note when it is longer.
 */
export function judgeMaterial(evalCase: EvalCase, evidence: Evidence): string {
  const lines = [
    '# What the person asked',
    ...askedLines(evalCase),
    '',
    '# What the assistant made',
    ...madeLines(evidence),
  ];
  return cut(lines.join('\n'), materialChars);
}
