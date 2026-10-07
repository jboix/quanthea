/**
 * An alert case in the report: the condition in words, the query, the replay over yesterday,
 * the tools the agent used, and what it said, where panels and queries show for a dashboard
 * question.
 */
import {
  type AlertCaseOutcome,
  conditionWords,
  type ReplayedSeriesSummary,
  utcClock,
} from './alert-score.ts';
import { escapeHtml } from './html.ts';
import { counted } from './report.ts';

/**
 * A series' labels, as `name=value, …`, or `all` without labels.
 *
 * @param series - The series.
 * @returns The words.
 */
function labelsOf(series: ReplayedSeriesSummary): string {
  const labels = Object.entries(series.labels).map(([name, value]) => `${name}=${value}`);
  return labels.length > 0 ? labels.join(', ') : 'all';
}

/**
 * A series that fired, in one line: when, and the spikes too short to fire.
 *
 * @param series - The series.
 * @returns The line.
 */
function firedLine(series: ReplayedSeriesSummary): string {
  const periods = series.firing.map(
    (period) => `${utcClock(period.from)} to ${period.ongoing ? 'the end' : utcClock(period.to)}`,
  );
  const fired = counted(series.firing.length, 'time', 'times');
  return `${labelsOf(series)}: fired ${fired} (${periods.join('; ')}), ${counted(series.tooShort, 'spike', 'spikes')} too short`;
}

/**
 * The replay over yesterday in lines: each series that fired, then how many never did.
 *
 * @param outcome - The alert case's outcome.
 * @returns The lines.
 */
export function replayLines(outcome: AlertCaseOutcome): string[] {
  const { replay } = outcome;
  if (!replay) return ['Not replayed.'];
  if (!replay.replayable) return [`Not replayable: ${replay.reason}`];
  const fired = replay.series.filter((series) => series.firing.length > 0);
  const quiet = replay.series.length - fired.length;
  const rest = quiet > 0 ? [`${counted(quiet, 'other series', 'other series')} never fired.`] : [];
  return [...fired.map(firedLine), ...rest];
}

/**
 * The facts of the alert, in lines: the condition, the query, the tools, the panel.
 *
 * @param outcome - The alert case's outcome.
 * @returns The lines.
 */
function factLines(outcome: AlertCaseOutcome): string[] {
  const tools = Object.entries(outcome.toolCalls).map(([name, calls]) =>
    calls > 1 ? `${name} ×${calls}` : name,
  );
  const used = `Tools: ${tools.length > 0 ? tools.join(', ') : 'none'}.`;
  const { spec, panel } = outcome;
  const asked = outcome.asked.map((text) => `The agent asked: “${text}”`);
  const sameQuery = panel?.alert === panel?.panel ? 'yes' : 'no';
  const matched = panel
    ? [`Same query as the panel: ${sameQuery}. Links: ${panel.links.join(', ') || 'none'}.`]
    : [];
  if (!spec) return ['No alert version was saved.', used, ...asked];
  const condition = `“${spec.title}”: ${conditionWords(spec)}, ${counted(outcome.versions, 'version', 'versions')} saved.`;
  return [condition, used, ...matched, ...asked];
}

/**
 * The alert's query, written out.
 *
 * @param outcome - The alert case's outcome.
 * @returns The query, or nothing.
 */
function queryText(outcome: AlertCaseOutcome): string | undefined {
  if (!outcome.spec) return undefined;
  const query = outcome.spec.query as Record<string, unknown>;
  const text = query.expr ?? query.sql;
  return typeof text === 'string' ? text : JSON.stringify(query, null, 2);
}

/**
 * An alert case's body in Markdown: the facts, the query, the replay and what the agent said.
 *
 * @param outcome - The alert case's outcome.
 * @returns The lines.
 */
export function markdownAlertBody(outcome: AlertCaseOutcome): string[] {
  const query = queryText(outcome);
  const said = outcome.said
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `> ${line}`);
  return [
    ...factLines(outcome).map((line) => `- ${line}`),
    ...(query ? ['', '```', query, '```'] : []),
    '',
    'Replay over yesterday:',
    '',
    ...replayLines(outcome).map((line) => `- ${line}`),
    ...(said.length > 0 ? ['', ...said] : []),
  ];
}

/**
 * An alert case's body in HTML: the facts, the replay, then the query and what the agent said in
 * folds.
 *
 * @param outcome - The alert case's outcome.
 * @returns The HTML.
 */
export function htmlAlertBody(outcome: AlertCaseOutcome): string {
  const item = (line: string) => `<li>${escapeHtml(line)}</li>`;
  const query = queryText(outcome);
  const queryFold = query
    ? `<details><summary>The query</summary><pre>${escapeHtml(query)}</pre></details>`
    : '';
  const saidFold = outcome.said
    ? `<details><summary>What the agent said</summary><blockquote class="answer">${escapeHtml(outcome.said)}</blockquote></details>`
    : '';
  return `<ul class="panels">${factLines(outcome).map(item).join('')}</ul>
<p class="asked">Replay over yesterday:</p><ul class="panels">${replayLines(outcome).map(item).join('')}</ul>
${queryFold}${saidFold}`;
}
