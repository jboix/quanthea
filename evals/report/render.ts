/**
 * A report to read: Markdown for the job's summary page in GitHub Actions, and a self-contained
 * HTML page. Both show the two headline numbers, then each case's status and why, its trials, its
 * layout mark, its cost, each check and rubric sentence, and what it made: for a dashboard, each
 * panel with its query; for an answer, its text and each read; for an alert, the condition, the
 * replay and the tools used; for a report, the schedule, the period and the run's numbers. A run
 * with parity cases also shows a table of the families of panels, by family id.
 */
import { isAlert } from '../checks/alert.ts';
import { isAnswer } from '../checks/answer.ts';
import { type Outcome, shownOf } from '../checks/dashboard.ts';
import { isReport, type OrderTruth } from '../checks/report.ts';
import { isRunAnswer } from '../checks/run-answer.ts';
import { askOf, type Evidence } from '../core/case.ts';
import { type CaseResult, caseStatus, type TrialResult } from '../core/result.ts';
import { queriesOf } from '../surfaces/query-text.ts';
import { escapeHtml } from './html.ts';
import { htmlAlertBody, markdownAlertBody } from './render-alert.ts';
import { htmlAnswerBody, markdownAnswerBody } from './render-answer.ts';
import { htmlLayout, layoutLine, markdownLayout } from './render-layout.ts';
import { htmlParity, markdownParity } from './render-parity.ts';
import {
  htmlReportBody,
  htmlRunAnswerBody,
  markdownReportBody,
  markdownRunAnswerBody,
} from './render-report.ts';
import { htmlTrial, markdownTrial, trialsLine } from './render-trial.ts';
import {
  cacheSentence,
  caseOf,
  counted,
  dollars,
  fractionWords,
  headlineOf,
  madeOf,
  type Report,
  statusWord,
  tokensOf,
  totalUsage,
  usageOf,
} from './report.ts';
import { headlineLines, shownTrial, whyOf } from './summary.ts';

/**
 * What a case asks, by its id.
 *
 * @param id - The id.
 * @returns Its turns, or the panel it explains; the id when the case is gone.
 */
function questionText(id: string): string {
  const evalCase = caseOf(id);
  return evalCase ? askOf(evalCase) : id;
}

/**
 * What a trial made, with the truth its report checks compared with, for the body to show.
 *
 * @param trial - The trial.
 * @returns The evidence.
 */
function shownEvidence(trial: TrialResult): Evidence {
  const { evidence } = trial;
  const orders = trial.truth.orders as OrderTruth | undefined;
  return isReport(evidence) && orders ? { ...evidence, truth: orders } : evidence;
}

/**
 * The headline: how many pass, on which models, when, what it cost, where the answers came
 * from, and how many layouts read well.
 *
 * @param report - The report.
 * @returns The lines.
 */
function headline(report: Report): {
  readonly title: string;
  readonly facts: string;
  readonly numbers: readonly string[];
  readonly cache: string;
  readonly layout: string;
} {
  const { pass, of } = headlineOf(report.results);
  const usage = totalUsage(report.results);
  const { model, build } = report.models;
  const models = build ? `${model}, building with ${build}` : model;
  const when = report.startedAt.slice(0, 16).replace('T', ' ');
  return {
    title: `Evals: ${pass} of ${of} pass`,
    facts: `${models} · ${when} UTC · ${tokensOf(usage).toLocaleString('en')} tokens · ${dollars(usage)} at list price`,
    numbers: headlineLines(report),
    cache: cacheSentence(report.cache),
    layout: layoutLine(report.results.map((result) => shownTrial(result)?.layout)) ?? '',
  };
}

/**
 * Text for a Markdown table cell: pipes escaped, lines joined.
 *
 * @param text - The text.
 * @returns The cell.
 */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** A sign for each status. */
const statusSigns = { pass: '✅', fail: '❌', review: '❓', error: '⚠️' } as const;

/**
 * The seconds a case's trials took together.
 *
 * @param result - The case's results.
 * @returns Such as `24 s`.
 */
function secondsOf(result: CaseResult): string {
  const total = result.trials.reduce((sum, trial) => sum + trial.evidence.durationMs, 0);
  return `${Math.round(total / 1000)} s`;
}

/**
 * A case's row of the Markdown table.
 *
 * @param result - The case's results.
 * @returns The row.
 */
function markdownRow(result: CaseResult): string {
  const trial = shownTrial(result);
  const cells = [
    `${statusSigns[caseStatus(result)]} ${result.id} ${fractionWords(result)}`.trim(),
    result.bucket,
    cell(questionText(result.id)),
    ...(trial ? madeOf(trial.evidence) : ['', '']),
    tokensOf(usageOf(result)).toLocaleString('en'),
    dollars(usageOf(result)),
    secondsOf(result),
    cell(whyOf(result).join('; ')),
    cell(markdownLayout(trial?.layout)),
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * A case's details in Markdown, folded: its checks and verdicts, then what it made.
 *
 * @param result - The case's results.
 * @returns The block.
 */
function markdownDetails(result: CaseResult): string {
  const trial = shownTrial(result);
  const body = trial ? [...markdownTrial(trial), '', ...markdownBody(shownEvidence(trial))] : [];
  if (trial?.evidence.error) body.unshift(`The run failed: ${trial.evidence.error}`);
  return `<details><summary>${result.id} · ${questionText(result.id)}</summary>\n\n${body.join('\n')}\n\n</details>`;
}

/**
 * An outcome's body in Markdown, by its kind.
 *
 * @param outcome - The outcome.
 * @returns The lines.
 */
function markdownBody(outcome: Evidence): string[] {
  if (isReport(outcome)) return markdownReportBody(outcome);
  if (isRunAnswer(outcome)) return markdownRunAnswerBody(outcome);
  if (isAlert(outcome)) return markdownAlertBody(outcome);
  return isAnswer(outcome) ? markdownAnswerBody(outcome) : markdownBuild(outcome);
}

/**
 * An outcome's body in HTML, by its kind.
 *
 * @param outcome - The outcome.
 * @returns The HTML.
 */
function htmlBody(outcome: Evidence): string {
  if (isReport(outcome)) return htmlReportBody(outcome);
  if (isRunAnswer(outcome)) return htmlRunAnswerBody(outcome);
  if (isAlert(outcome)) return htmlAlertBody(outcome);
  return isAnswer(outcome) ? htmlAnswerBody(outcome) : htmlBuild(outcome);
}

/**
 * A question's details in Markdown: what the agent asked, and each panel with its queries.
 *
 * @param outcome - The question's outcome.
 * @returns The lines.
 */
function markdownBuild(outcome: Outcome): string[] {
  const asked = outcome.asked.map((text) => `The agent asked: “${text}” It got its first option.`);
  const shown = shownOf(outcome);
  const panels = shown.flatMap((panel) => [
    `- **${panel.title}** · ${panel.connectors.join(', ')}`,
    ...queriesOf(panel).map(
      (query) =>
        `  \`\`\`${query.language === 'promql' ? '' : query.language}\n  ${query.text.replaceAll('\n', '\n  ')}\n  \`\`\``,
    ),
  ]);
  const last =
    !outcome.built && outcome.lastWords ? [`The agent's last words: “${outcome.lastWords}”`] : [];
  return [...asked, ...last, '', ...(panels.length > 0 ? panels : ['No panel was built.'])];
}

/**
 * The report in Markdown, for the job's summary page.
 *
 * @param report - The report.
 * @returns The Markdown.
 */
export function markdownReport(report: Report): string {
  const { title, facts, numbers, cache, layout } = headline(report);
  return [
    `## ${title}`,
    '',
    facts,
    '',
    ...numbers.map((line) => `- ${line}`),
    '',
    cache,
    '',
    ...(layout ? [layout, ''] : []),
    ...markdownParity(report),
    '| | Bucket | Question | Built, read or saved | Repairs or steps | Tokens | Cost | Time | Why it fails | Layout |',
    '| --- | --- | --- | --: | --: | --: | --: | --: | --- | --- |',
    ...report.results.map(markdownRow),
    '',
    ...report.results.map(markdownDetails),
    '',
  ].join('\n');
}

/**
 * A question's body in HTML: what the agent asked or said last, and each panel with its queries.
 *
 * @param outcome - The question's outcome.
 * @returns The HTML.
 */
function htmlBuild(outcome: Outcome): string {
  const asked = outcome.asked
    .map(
      (text) =>
        `<p class="asked">The agent asked “${escapeHtml(text)}” and got its first option.</p>`,
    )
    .join('');
  const panels = shownOf(outcome).map((panel) => {
    const queries = queriesOf(panel)
      .map((query) => `<pre>${escapeHtml(query.text)}</pre>`)
      .join('');
    return `<li><strong>${escapeHtml(panel.title)}</strong> <span class="muted">${escapeHtml(panel.connectors.join(', '))}</span>${queries}</li>`;
  });
  const last =
    !outcome.built && outcome.lastWords
      ? `<p class="asked">The agent's last words: “${escapeHtml(outcome.lastWords)}”</p>`
      : '';
  return `${asked}${last}
<details><summary>${panels.length > 0 ? 'Panels and queries' : 'No panel was built'}</summary><ul class="panels">${panels.join('')}</ul></details>`;
}

/**
 * A case's section of the HTML page: read on the trial its line shows.
 *
 * @param result - The case's results.
 * @returns The HTML.
 */
function htmlQuestion(result: CaseResult): string {
  const trial = shownTrial(result);
  const status = caseStatus(result);
  const reasons = whyOf(result)
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join('');
  const stats = [
    result.bucket,
    ...(trial ? madeOf(trial.evidence) : []),
    counted(tokensOf(usageOf(result)), 'token', 'tokens'),
    dollars(usageOf(result)),
    secondsOf(result),
    trialsLine(result),
  ]
    .filter((each) => each !== '')
    .join(' · ');
  const reasonList = reasons ? `<ul class="reasons">${reasons}</ul>` : '';
  const body = trial ? `${htmlTrial(trial)}\n${htmlBody(shownEvidence(trial))}` : '';
  return `<section class="question" data-status="${status}">
<h2><span class="verdict">${statusWord(status).toLowerCase()} ${fractionWords(result)}</span> ${escapeHtml(result.id)} · ${escapeHtml(questionText(result.id))}</h2>
<p class="muted">${escapeHtml(stats)}</p>
${reasonList}${htmlLayout(trial?.layout)}
${body}
</section>`;
}

/** The page's styles: light and dark, no external resource. */
const styles = `:root { color-scheme: light dark; --ground: #f4f3ef; --surface: #fff; --ink: #17181c; --muted: #55575e; --border: #e2e0d9; --ok: #2f7d4f; --ok-soft: #e8f4ec; --bad: #8f2a1c; --bad-soft: #fbedea; }
@media (prefers-color-scheme: dark) { :root { --ground: #17181c; --surface: #202127; --ink: #ecebe6; --muted: #a3a49f; --border: #33343b; --ok: #6cc08f; --ok-soft: #1d3326; --bad: #f08b7a; --bad-soft: #3a211d; } }
body { margin: 0; padding: 32px 16px; background: var(--ground); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 24px; }
h2 { margin: 0; font-size: 16px; }
.muted { color: var(--muted); margin: 4px 0; }
.question { margin: 16px 0; padding: 16px 20px; border: 1px solid var(--border); border-left: 4px solid var(--ok); border-radius: 10px; background: var(--surface); }
.question[data-status="fail"] { border-left-color: var(--bad); }
.question[data-status="review"], .question[data-status="error"] { border-left-color: var(--muted); }
.verdict { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); font-size: 12px; text-transform: uppercase; }
.question[data-status="fail"] .verdict { background: var(--bad-soft); color: var(--bad); }
.question[data-status="review"] .verdict, .question[data-status="error"] .verdict { background: var(--ground); color: var(--muted); }
.checks { padding-left: 18px; list-style: none; }
.checks li[data-outcome="fail"], .checks li[data-outcome="no"] { color: var(--bad); }
.checks li[data-outcome="skipped"] { color: var(--muted); }
.reasons { color: var(--bad); margin: 8px 0; }
.asked, .layout { margin: 8px 0; }
.panels { padding-left: 18px; }
.panels li { margin: 10px 0; }
pre { margin: 6px 0 0; padding: 8px 10px; overflow-x: auto; border-radius: 8px; background: var(--ground); font: 12.5px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
summary { cursor: pointer; color: var(--muted); }
.answer { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--border); white-space: pre-wrap; }
.parity { margin: 16px 0; padding: 16px 20px; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.parity table { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 14px; }
.parity th, .parity td { padding: 5px 8px; border-top: 1px solid var(--border); text-align: left; vertical-align: top; }
.parity th { border-top: 0; color: var(--muted); font-weight: 500; }
.status { padding: 1px 8px; border-radius: 6px; background: var(--ground); color: var(--muted); font-size: 12px; text-transform: uppercase; }
tr[data-status="green"] .status { background: var(--ok-soft); color: var(--ok); }
tr[data-status="red"] .status { background: var(--bad-soft); color: var(--bad); }
.mark[data-mark="yes"] { color: var(--ok); }
.mark[data-mark="no"] { color: var(--bad); }`;

/**
 * The report as one HTML page, with no script and no external resource.
 *
 * @param report - The report.
 * @returns The HTML.
 */
export function htmlReport(report: Report): string {
  const { title, facts, numbers, cache, layout } = headline(report);
  const lines = numbers.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles}</style></head>
<body><main>
<h1>${escapeHtml(title)}</h1>
<p class="muted">${escapeHtml(facts)}</p>
<ul>${lines}</ul>
<p class="muted">${escapeHtml(cache)}</p>
${layout ? `<p class="muted">${escapeHtml(layout)}</p>` : ''}
${htmlParity(report)}
${report.results.map(htmlQuestion).join('\n')}
</main></body>
</html>
`;
}
