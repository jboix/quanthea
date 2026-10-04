/**
 * The instructions of a question about a report's run: the rules, then the facts. The facts are
 * the run's period and the period it compares with, the report as written (never data), and each
 * connector with what the model may read of it, frozen or by querying again.
 */
import type { DashboardSpec, VariableValues } from '@quanthea/shared';
import { type AnswerConnector, dashboardText, localTime, variablesLine } from './answer-prompt.ts';
import type { FrozenRun } from './frozen-run.ts';

/** How a question about a run is answered. */
const runRules = `You answer questions about one run of a report for the people reading it: a calm, precise colleague who reads the data before saying anything about it.

Rules:
- The report ran its panels over the period below, and over the period before when it compares, and froze the results. read_run reads a panel's frozen results ("run" or "comparison") and runs no query: start there, they are what the report showed and sent.
- What read_run shows follows each connector's access level, listed below: level 1 whether the query ran, level 2 the shape (fields, types, row counts), level 3 summaries, level 4 rows.
- read_data, when offered, queries a connector at level 3 or 4 again, to look closer than the frozen results: a panel's query (panelId) or one of your own, over the period or a window you set.
- When the frozen totals cannot say what stood out (no comparison data, or one number for the whole period), look closer with read_data before answering: the same measure per hour or per day across the period, to find when it moved and how.
- Answer from evidence only: the report below and what your reads return. Never guess or invent a number, a time or a cause.
- Cite with markers [1], [2], in order. Every number and every claim about the data has one. A marker's citation names the read that shows it (evidenceId), the panel it is about (panelId), and, for a moment or a stretch of time, the window (from, to) inside the run's period.
- Give times as absolute times in the report's time zone, such as "Thu 2 Oct 14:00 to 15:00".
- Say what you could not see. When a connector is at level 1 or 2, say plainly that you see the shape of its results and not their numbers, and that an admin can raise it to Aggregates or Full access.
- When the answer points at something worth watching, or when asked what to watch, call propose_follow_up before give_answer, with at most 3 cards: an alert to be told when it happens again, or a dashboard to look at it closer. Each prompt is the first message of the conversation a person would start: plain words naming the source, the measure, the threshold or the window. Propose only what the evidence supports.
- Short: two to four plain sentences. No headings, no tables, no lists unless asked. Answer in the person's language.
- End with give_answer: only what you give there reaches the person. If it reports issues, fix them and call it again.`;

/** What the model is told when no connector of the run shows numbers. */
const shapesOnly = `No connector of this report is at level 3 or 4: read_run shows the shape of its frozen results, never their numbers. Say so plainly in your first sentence, and never quote a measurement.`;

/** The facts of a question about a run. */
export interface RunFacts {
  /** The report's panels over the run's period. */
  readonly spec: DashboardSpec;
  /** The connectors the report uses that exist. */
  readonly connectors: readonly AnswerConnector[];
  /** The run's period, epoch milliseconds. */
  readonly range: { readonly from: number; readonly to: number };
  /** The schedule's time zone. */
  readonly timeZone: string;
  /** The variable values the run bound: the defaults. */
  readonly variables: VariableValues;
  /** The run. */
  readonly run: FrozenRun;
}

/**
 * A window in words: local, in a zone, then in UTC.
 *
 * @param range - The window, epoch milliseconds.
 * @param timeZone - The zone.
 * @returns Such as `2025-09-29, 00:00 to 2025-10-05, 23:59 in Europe/Zurich, that is …`.
 */
function windowLine(range: { readonly from: number; readonly to: number }, timeZone: string) {
  const local = `${localTime(range.from, timeZone)} to ${localTime(range.to, timeZone)}`;
  const iso = `${new Date(range.from).toISOString()} to ${new Date(range.to).toISOString()}`;
  return `${local} in ${timeZone}, that is ${iso}`;
}

/**
 * One line per connector: what the model may read of it, frozen and by querying.
 *
 * @param connectors - The report's connectors.
 * @returns The lines.
 */
function runConnectorLines(connectors: readonly AnswerConnector[]): string[] {
  return connectors.map(({ name, kind, language, accessLevel }) => {
    const shown = accessLevel === 2 ? 'the shape' : 'whether it ran';
    const reads =
      accessLevel >= 3
        ? `read_run and read_data return ${accessLevel >= 4 ? 'summaries and rows' : 'summaries, never rows'}`
        : `read_run returns ${shown}, never numbers`;
    return `- ${name} (${kind}, ${language}): level ${accessLevel}: ${reads}.`;
  });
}

/**
 * The instructions of a question about a run.
 *
 * @param facts - The report, its connectors, the period, the zone, the variables and the run.
 * @param readable - Whether a level lets the model read numbers.
 * @returns The instructions.
 */
export function runInstructions(facts: RunFacts, readable: (level: number) => boolean): string {
  const { run, timeZone } = facts;
  const anyReadable = facts.connectors.some((connector) => readable(connector.accessLevel));
  const compared = run.comparison
    ? [`It compares with ${run.comparison.label}: ${windowLine(run.comparison, timeZone)}.`]
    : ['It compares with no period before.'];
  return [
    runRules,
    ...(anyReadable ? [] : [shapesOnly]),
    '',
    `The run covers ${run.label}: ${windowLine(facts.range, timeZone)}.`,
    ...compared,
    ...[variablesLine(facts.spec, facts.variables)].filter((line) => line !== undefined),
    'Connectors:',
    ...runConnectorLines(facts.connectors),
    'Report:',
    dashboardText(facts.spec),
  ].join('\n');
}
