/**
 * A report to read: Markdown for the job's summary page in GitHub Actions, and a self-contained
 * HTML page. Both show each question's verdict and why, its cost, what the agent asked, and each
 * panel with its query; for an answer case, the answer's text and each read.
 */

import { answerCases, caseText } from './answer-cases.ts';
import { isAnswer } from './answer-score.ts';
import { escapeHtml } from './html.ts';
import { questions } from './questions.ts';
import { htmlAnswerBody, markdownAnswerBody } from './render-answer.ts';
import type { Report, Result } from './report.ts';
import { cacheSentence, counted, dollars, madeOf, tokensOf, totalUsage } from './report.ts';
import { type BuiltPanel, type Outcome, panelQueries, shownOf } from './score.ts';

/** One panel's query, written out, with its language for highlighting. */
interface PanelQuery {
  /** The language, such as `sql` or `promql`. */
  readonly language: string;
  /** The query. */
  readonly text: string;
}

/**
 * A panel's queries, written out for reading.
 *
 * @param panel - The panel.
 * @returns Its queries.
 */
function queriesOf(panel: BuiltPanel): PanelQuery[] {
  return panelQueries(panel).map((query) => {
    const {
      sql,
      expr,
      language,
      refId: _refId,
      connector: _connector,
      ...rest
    } = query as Record<string, unknown>;
    const text =
      typeof sql === 'string'
        ? sql
        : typeof expr === 'string'
          ? expr
          : JSON.stringify(rest, null, 2);
    return { language: String(language ?? ''), text };
  });
}

/**
 * What the person asked, by question or answer case id.
 *
 * @param id - The id.
 * @returns The question, or the panel an explanation is about.
 */
function questionText(id: string): string {
  const question = questions.find((each) => each.id === id);
  if (question) return question.question;
  const answerCase = answerCases.find((each) => each.id === id);
  return answerCase ? caseText(answerCase) : id;
}

/**
 * The headline: how many pass, on which models, when, what it cost, and where the answers came
 * from.
 *
 * @param report - The report.
 * @returns The lines.
 */
function headline(report: Report): {
  readonly title: string;
  readonly facts: string;
  readonly cache: string;
} {
  const passed = report.results.filter((result) => result.score.pass).length;
  const usage = totalUsage(report.results);
  const { model, build } = report.models;
  const models = build ? `${model}, building with ${build}` : model;
  const when = report.startedAt.slice(0, 16).replace('T', ' ');
  return {
    title: `Evals: ${passed} of ${report.results.length} pass`,
    facts: `${models} · ${when} UTC · ${tokensOf(usage).toLocaleString('en')} tokens · ${dollars(usage)} at list price`,
    cache: cacheSentence(report.cache),
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

/**
 * A question's row of the Markdown table.
 *
 * @param result - The question's result.
 * @returns The row.
 */
function markdownRow({ outcome, score }: Result): string {
  const cells = [
    `${score.pass ? '✅' : '❌'} ${outcome.id}`,
    cell(questionText(outcome.id)),
    ...madeOf(outcome),
    tokensOf(outcome.usage).toLocaleString('en'),
    dollars(outcome.usage),
    `${Math.round(outcome.durationMs / 1000)} s`,
    cell(score.reasons.join('; ')),
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * A question's or answer case's details in Markdown, folded.
 *
 * @param result - The result.
 * @returns The block.
 */
function markdownDetails({ outcome }: Result): string {
  const body = isAnswer(outcome) ? markdownAnswerBody(outcome) : markdownBuild(outcome);
  if (outcome.error) body.unshift(`The run failed: ${outcome.error}`);
  return `<details><summary>${outcome.id} · ${questionText(outcome.id)}</summary>\n\n${body.join('\n')}\n\n</details>`;
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
  const { title, facts, cache } = headline(report);
  return [
    `## ${title}`,
    '',
    facts,
    '',
    cache,
    '',
    '| | Question | Built or read | Repairs or steps | Tokens | Cost | Time | Why it fails |',
    '| --- | --- | --: | --: | --: | --: | --: | --- |',
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
 * A question's or answer case's section of the HTML page.
 *
 * @param result - The result.
 * @returns The HTML.
 */
function htmlQuestion({ outcome, score }: Result): string {
  const reasons = score.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
  const stats = [
    ...madeOf(outcome),
    counted(tokensOf(outcome.usage), 'token', 'tokens'),
    dollars(outcome.usage),
    `${Math.round(outcome.durationMs / 1000)} s`,
  ].join(' · ');
  const body = isAnswer(outcome) ? htmlAnswerBody(outcome) : htmlBuild(outcome);
  return `<section class="question" data-pass="${score.pass}">
<h2><span class="verdict">${score.pass ? 'pass' : 'fail'}</span> ${escapeHtml(outcome.id)} · ${escapeHtml(questionText(outcome.id))}</h2>
<p class="muted">${stats}</p>
${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}${outcome.error ? `<p class="reasons">The run failed: ${escapeHtml(outcome.error)}</p>` : ''}
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
.question[data-pass="false"] { border-left-color: var(--bad); }
.verdict { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); font-size: 12px; text-transform: uppercase; }
.question[data-pass="false"] .verdict { background: var(--bad-soft); color: var(--bad); }
.reasons { color: var(--bad); margin: 8px 0; }
.asked { margin: 8px 0; }
.panels { padding-left: 18px; }
.panels li { margin: 10px 0; }
pre { margin: 6px 0 0; padding: 8px 10px; overflow-x: auto; border-radius: 8px; background: var(--ground); font: 12.5px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
summary { cursor: pointer; color: var(--muted); }
.answer { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--border); white-space: pre-wrap; }`;

/**
 * The report as one HTML page, with no script and no external resource.
 *
 * @param report - The report.
 * @returns The HTML.
 */
export function htmlReport(report: Report): string {
  const { title, facts, cache } = headline(report);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles}</style></head>
<body><main>
<h1>${escapeHtml(title)}</h1>
<p class="muted">${escapeHtml(facts)}</p>
<p class="muted">${escapeHtml(cache)}</p>
${report.results.map(htmlQuestion).join('\n')}
</main></body>
</html>
`;
}
