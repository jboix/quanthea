/**
 * A report case and a run case in the report. A report case shows the schedule in words, the
 * period, the headline panels, the preview, the run's headline numbers beside the database's, the
 * tools and what the agent said. A run case shows each answer, its reads and its follow-up cards.
 */
import type { ReportPeriod, ReportSchedule, ReportSpec } from '@quanthea/shared';
import { escapeHtml } from './html.ts';
import { counted } from './report.ts';
import { headlineTopic, type OrderTruth, type ReportCaseOutcome } from './report-score.ts';
import type { RunAnswer, RunAnswerCaseOutcome } from './run-answer-score.ts';

/** Each period, in words. */
const periodWords: Record<ReportPeriod, string> = {
  previous_day: 'the day before',
  previous_week: 'the week before',
  previous_month: 'the month before',
  week_to_date: 'the week so far',
};

/**
 * A schedule in words, such as "every Monday at 07:00 (Europe/Zurich)".
 *
 * @param schedule - The schedule.
 * @returns The words.
 */
export function scheduleWords(schedule: ReportSchedule): string {
  const clock = `at ${schedule.at} (${schedule.timezone})`;
  if (schedule.every === 'day') return `every day ${clock}`;
  if (schedule.every === 'month') return `on day ${schedule.day} of every month ${clock}`;
  const weekday = `${schedule.weekday.charAt(0).toUpperCase()}${schedule.weekday.slice(1)}`;
  return `every ${weekday} ${clock}`;
}

/**
 * The spec's facts in lines: when it runs, what it covers, what it shows first.
 *
 * @param spec - The spec.
 * @param versions - How many versions the case saved.
 * @returns The lines.
 */
function specLines(spec: ReportSpec, versions: number): string[] {
  const compares = spec.compare === 'none' ? 'no comparison' : 'compared with the period before';
  const headlines = spec.summaryPanels.map(
    (id) => spec.panels.find((panel) => panel.id === id)?.title ?? id,
  );
  return [
    `“${spec.title}”: runs ${scheduleWords(spec.schedule)}, covers ${periodWords[spec.period]}, ${compares}; ${counted(versions, 'version', 'versions')} saved.`,
    `Headline panels: ${headlines.join(', ') || 'none'}. ${counted(spec.panels.length, 'panel', 'panels')}, ${counted(spec.delivery.channels.length, 'channel', 'channels')}.`,
  ];
}

/**
 * What the database holds for a headline's topic, in words.
 *
 * @param topic - The headline's topic.
 * @param truth - The database's counts.
 * @returns The words.
 */
function truthWords(topic: ReturnType<typeof headlineTopic>, truth: OrderTruth): string {
  if (topic === 'orders') return `the database: ${truth.paid} paid, ${truth.all} in all`;
  if (topic === 'revenue')
    return `the database: ${truth.paidCents} cents paid, ${truth.allCents} in all`;
  if (topic === 'failed') return `the database: ${truth.failed} failed of ${truth.all}`;
  return 'not checked';
}

/**
 * The run in lines: its period and status, then each headline beside the database's numbers.
 *
 * @param outcome - The report case's outcome.
 * @returns The lines.
 */
function runLines(outcome: ReportCaseOutcome): string[] {
  const { run, truth } = outcome;
  if (!run) return [];
  const status = run.status === 'ok' ? 'ok' : `${run.status}: ${run.error ?? 'no reason'}`;
  const headlines = run.headlines.map((headline) => {
    const change = headline.change ? `, ${headline.change.text}` : '';
    const against = truth ? `; ${truthWords(headlineTopic(headline), truth)}` : '';
    return `${headline.title}: ${headline.text} (${headline.value}${change})${against}`;
  });
  return [`Run over ${run.period.label}: ${status}.`, ...headlines];
}

/**
 * The facts of the report case in lines: the spec, the preview, the run, the tools, the asks.
 *
 * @param outcome - The report case's outcome.
 * @returns The lines.
 */
function reportLines(outcome: ReportCaseOutcome): string[] {
  const tools = Object.entries(outcome.toolCalls).map(([name, calls]) =>
    calls > 1 ? `${name} ×${calls}` : name,
  );
  const used = `Tools: ${tools.length > 0 ? tools.join(', ') : 'none'}.`;
  const asked = outcome.asked.map((text) => `The agent asked: “${text}”`);
  if (!outcome.spec) return ['No report version was saved.', used, ...asked];
  const failure = outcome.previewFailure;
  const preview = failure === null ? 'Preview: every query ran.' : `Preview failed: ${failure}`;
  return [
    ...specLines(outcome.spec, outcome.versions),
    preview,
    ...runLines(outcome),
    used,
    ...asked,
  ];
}

/**
 * The spec's panels with their queries, written out.
 *
 * @param spec - The spec, if any.
 * @returns One entry per panel.
 */
function panelQueries(spec: ReportSpec | undefined): { title: string; text: string }[] {
  return (spec?.panels ?? []).map((panel) => ({
    title: `${panel.title} (${panel.id})`,
    text: panel.queries
      .map((query) => {
        const { sql } = query as { sql?: unknown };
        return typeof sql === 'string' ? sql : JSON.stringify(query, null, 2);
      })
      .join('\n'),
  }));
}

/**
 * A report case's body in Markdown: the facts, each panel's query, and what the agent said.
 *
 * @param outcome - The report case's outcome.
 * @returns The lines.
 */
export function markdownReportBody(outcome: ReportCaseOutcome): string[] {
  const panels = panelQueries(outcome.spec).flatMap((panel) => [
    `- **${panel.title}**`,
    '  ```sql',
    `  ${panel.text.replaceAll('\n', '\n  ')}`,
    '  ```',
  ]);
  const said = outcome.said
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `> ${line}`);
  return [
    ...reportLines(outcome).map((line) => `- ${line}`),
    ...(panels.length > 0 ? ['', ...panels] : []),
    ...(said.length > 0 ? ['', ...said] : []),
  ];
}

/**
 * A report case's body in HTML: the facts, then the panels and what the agent said in folds.
 *
 * @param outcome - The report case's outcome.
 * @returns The HTML.
 */
export function htmlReportBody(outcome: ReportCaseOutcome): string {
  const item = (line: string) => `<li>${escapeHtml(line)}</li>`;
  const panels = panelQueries(outcome.spec).map(
    (panel) =>
      `<li><strong>${escapeHtml(panel.title)}</strong><pre>${escapeHtml(panel.text)}</pre></li>`,
  );
  const panelFold =
    panels.length > 0
      ? `<details><summary>Panels and queries</summary><ul class="panels">${panels.join('')}</ul></details>`
      : '';
  const saidFold = outcome.said
    ? `<details><summary>What the agent said</summary><blockquote class="answer">${escapeHtml(outcome.said)}</blockquote></details>`
    : '';
  return `<ul class="panels">${reportLines(outcome).map(item).join('')}</ul>
${panelFold}${saidFold}`;
}

/**
 * An answer about a run in lines: its reads and its follow-up cards.
 *
 * @param answer - The answer.
 * @returns The lines.
 */
function answerLines(answer: RunAnswer): string[] {
  const reads = answer.evidence.map(
    (read) =>
      `${read.id} · ${read.frozen ? 'frozen read' : 'new read'} · ${read.connector}${read.panelId ? ` · panel ${read.panelId}` : ''}`,
  );
  const cards = answer.followUps.map(
    (card) => `Follow-up (${card.kind}): ${card.title}: “${card.prompt}”`,
  );
  const tools = Object.keys(answer.toolCalls).join(', ') || 'none';
  return [...reads, ...cards, `Tools: ${tools}; ${counted(answer.steps, 'step', 'steps')}.`];
}

/**
 * What the service said: the answer's text, or why there is none.
 *
 * @param answer - The answer.
 * @returns The words.
 */
function saidOf(answer: RunAnswer): string {
  return answer.text ?? `No answer: ${answer.message ?? 'no reason given'}`;
}

/**
 * A run case's body in Markdown: each question, its answer, its reads and its cards.
 *
 * @param outcome - The run case's outcome.
 * @returns The lines.
 */
export function markdownRunAnswerBody(outcome: RunAnswerCaseOutcome): string[] {
  const period = outcome.period ? [`About the run over ${outcome.period}.`, ''] : [];
  return [
    ...period,
    ...outcome.answers.flatMap((answer) => [
      `**${answer.question}**`,
      '',
      ...saidOf(answer)
        .split('\n')
        .map((line) => `> ${line}`),
      '',
      ...answerLines(answer).map((line) => `- ${line}`),
      '',
    ]),
  ];
}

/**
 * A run case's body in HTML: each question, its answer, then its reads and cards.
 *
 * @param outcome - The run case's outcome.
 * @returns The HTML.
 */
export function htmlRunAnswerBody(outcome: RunAnswerCaseOutcome): string {
  const period = outcome.period
    ? `<p class="muted">About the run over ${escapeHtml(outcome.period)}.</p>`
    : '';
  const answers = outcome.answers.map((answer) => {
    const lines = answerLines(answer)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('');
    return `<p class="asked"><strong>${escapeHtml(answer.question)}</strong></p>
<blockquote class="answer">${escapeHtml(saidOf(answer))}</blockquote><ul class="panels">${lines}</ul>`;
  });
  return `${period}${answers.join('\n')}`;
}
