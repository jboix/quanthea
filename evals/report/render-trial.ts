/**
 * A trial in the report: each check with how it came out, each rubric sentence with the judge's
 * verdict and why, and the tool calls of the run, folded, to read when it fails.
 */
import type { CaseResult, CheckOutcome, TrialResult, Verdict } from '../core/result.ts';
import { escapeHtml } from './html.ts';

/** How each outcome and verdict is shown. */
const signs = {
  pass: '✅',
  fail: '❌',
  skipped: '➖',
  yes: '✅',
  no: '❌',
  uncertain: '❓',
} as const;

/**
 * A check, in a line: its sign, its name and its kind, then what does not hold.
 *
 * @param check - The check's outcome.
 * @returns The line.
 */
function checkLine(check: CheckOutcome): string {
  const why = check.message ? `: ${check.message}` : '';
  return `${signs[check.outcome]} ${check.id} (${check.kind})${why}`;
}

/**
 * A verdict, in a line: its sign, the sentence, then why and what it is based on.
 *
 * @param verdict - The verdict.
 * @returns The line.
 */
function verdictLine(verdict: Verdict): string {
  const based = verdict.evidence ? ` Based on: “${verdict.evidence}”` : '';
  return `${signs[verdict.verdict]} ${verdict.sentence} ${verdict.reason}${based}`.trim();
}

/**
 * The status of each trial of a case, in a line, when it has more than one.
 *
 * @param result - The case's results.
 * @returns Such as `Trials: pass, fail, pass`; nothing for one trial.
 */
export function trialsLine(result: CaseResult): string {
  if (result.trials.length < 2) return '';
  return `Trials: ${result.trials.map((trial) => trial.status).join(', ')}`;
}

/**
 * A trial's checks and verdicts in Markdown.
 *
 * @param trial - The trial.
 * @returns The lines.
 */
export function markdownTrial(trial: TrialResult): string[] {
  return [
    ...trial.checks.map((check) => `- ${checkLine(check)}`),
    ...trial.verdicts.map((verdict) => `- ${verdictLine(verdict)}`),
  ];
}

/**
 * A trial's tool calls in HTML, folded.
 *
 * @param trial - The trial.
 * @returns The HTML; empty when the trace holds no call.
 */
function htmlTrace(trial: TrialResult): string {
  const { toolCalls, retries } = trial.trace;
  if (toolCalls.length === 0) return '';
  const calls = toolCalls
    .map(
      (call) =>
        `<li><strong>${escapeHtml(call.tool)}</strong><pre>${escapeHtml(call.input)}</pre><pre>${escapeHtml(call.output)}</pre></li>`,
    )
    .join('');
  const again = retries > 0 ? `, after ${retries} run that erred` : '';
  return `<details><summary>${toolCalls.length} tool calls${again}</summary><ol class="panels">${calls}</ol></details>`;
}

/**
 * A trial's checks, verdicts and tool calls in HTML.
 *
 * @param trial - The trial.
 * @returns The HTML.
 */
export function htmlTrial(trial: TrialResult): string {
  const checks = trial.checks
    .map((check) => `<li data-outcome="${check.outcome}">${escapeHtml(checkLine(check))}</li>`)
    .join('');
  const verdicts = trial.verdicts
    .map((each) => `<li data-outcome="${each.verdict}">${escapeHtml(verdictLine(each))}</li>`)
    .join('');
  return `<details><summary>${trial.checks.length} checks, ${trial.verdicts.length} rubric sentences</summary><ul class="checks">${checks}${verdicts}</ul></details>
${htmlTrace(trial)}`;
}
