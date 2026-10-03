/**
 * An answer case in the report: the answer's text, or why there is none, and each read the model
 * made, where panels and queries show for a dashboard question.
 */
import type { AnswerCaseOutcome, ReadSummary } from './answer-score.ts';
import { escapeHtml } from './html.ts';

/**
 * A read in one line: its id, connector, panel and window.
 *
 * @param read - The read.
 * @returns The line.
 */
function readLine(read: ReadSummary): string {
  const panel = read.panelId === undefined ? '' : ` · panel ${read.panelId}`;
  return `${read.id} · ${read.connector}${panel} · ${read.time.from} to ${read.time.to}`;
}

/**
 * What the service said: the answer's text, or why there is none.
 *
 * @param outcome - The answer case's outcome.
 * @returns The words.
 */
function saidOf(outcome: AnswerCaseOutcome): string {
  if (outcome.text !== undefined) return outcome.text;
  return `No answer: ${outcome.message ?? outcome.error ?? 'no reason given'}`;
}

/**
 * An answer case's body in Markdown: the text, then each read.
 *
 * @param outcome - The answer case's outcome.
 * @returns The lines.
 */
export function markdownAnswerBody(outcome: AnswerCaseOutcome): string[] {
  const reads = outcome.evidence.flatMap((read) => [
    `- **${readLine(read)}**`,
    `  \`${read.result.replaceAll('`', "'")}\``,
  ]);
  const quoted = saidOf(outcome)
    .split('\n')
    .map((line) => `> ${line}`);
  return [...quoted, '', ...(reads.length > 0 ? reads : ['No data was read.'])];
}

/**
 * An answer case's body in HTML: the text, then each read in a fold.
 *
 * @param outcome - The answer case's outcome.
 * @returns The HTML.
 */
export function htmlAnswerBody(outcome: AnswerCaseOutcome): string {
  const reads = outcome.evidence.map(
    (read) =>
      `<li><strong>${escapeHtml(readLine(read))}</strong><pre>${escapeHtml(read.result)}</pre></li>`,
  );
  const summary = reads.length > 0 ? 'Reads and what they returned' : 'No data was read';
  return `<blockquote class="answer">${escapeHtml(saidOf(outcome))}</blockquote>
<details><summary>${summary}</summary><ul class="panels">${reads.join('')}</ul></details>`;
}
