import { describe, expect, test } from 'bun:test';
import type { Outcome } from '../checks/dashboard.ts';
import type { Verdict } from '../core/result.ts';
import { reportOf } from '../core/test/scoring.ts';
import type { Report } from '../report/report.ts';
import { agreement, type Label } from './commands.ts';

const sentences = [
  'A panel shows the refunds broken down by reason.',
  'It keeps to the 5 slowest.',
];

/**
 * A judged report of one trial of q9, with the judge's verdict on each sentence.
 *
 * @param startedAt - When its run started, which names it.
 * @param verdicts - What the judge said of each sentence.
 * @returns The report.
 */
function judgedReport(startedAt: string, verdicts: readonly Verdict['verdict'][]): Report {
  const made = { id: 'q9', built: true, panels: [], failing: [], repairs: 0, asked: [] };
  const evidence: Outcome = { ...made, turns: 1, usage: {}, durationMs: 1 };
  const report = reportOf([evidence]);
  const given = verdicts.map((verdict, index) => ({
    sentence: sentences[index] ?? '',
    verdict,
    reason: 'because',
    evidence: '',
  }));
  const results = report.results.map((result) => ({
    ...result,
    trials: result.trials.map((trial) => ({ ...trial, verdicts: given })),
  }));
  return { ...report, startedAt, results };
}

/**
 * A label on a sentence of the first trial of q9.
 *
 * @param report - The report it is about.
 * @param sentence - Which sentence.
 * @param label - What the maintainer says.
 * @returns The label.
 */
function labelled(report: string, sentence: number, label: Label['label']): Label {
  return { report, case: 'q9', trial: 1, sentence: sentences[sentence] ?? '', label };
}

describe('how a judge agrees with the maintainer', () => {
  const monday = judgedReport('2026-10-12T10:00:00.000Z', ['yes', 'no']);
  const tuesday = judgedReport('2026-10-13T10:00:00.000Z', ['yes', 'uncertain']);

  test('counts the verdicts that say what the label says', () => {
    const labels = [labelled(monday.startedAt, 0, 'yes'), labelled(monday.startedAt, 1, 'no')];
    expect(agreement([monday], labels)).toEqual({
      labelled: 2,
      agree: 2,
      wrongPass: 0,
      wrongFail: 0,
      uncertain: 0,
      stale: 0,
    });
  });

  test('counts a wrong pass apart from a wrong failure, and an unsure verdict as neither', () => {
    const labels = [
      labelled(monday.startedAt, 0, 'no'),
      labelled(monday.startedAt, 1, 'yes'),
      labelled(tuesday.startedAt, 1, 'yes'),
    ];
    expect(agreement([monday, tuesday], labels)).toMatchObject({
      labelled: 3,
      agree: 0,
      wrongPass: 1,
      wrongFail: 1,
      uncertain: 1,
    });
  });

  test('a label with no verdict to compare is stale: another report, or a sentence since edited', () => {
    const elsewhere = labelled('2026-01-01T00:00:00.000Z', 0, 'yes');
    const edited = { ...labelled(monday.startedAt, 0, 'yes'), sentence: 'A panel shows refunds.' };
    expect(agreement([monday], [elsewhere, edited])).toMatchObject({ labelled: 0, stale: 2 });
  });

  test('leaves out the labels the maintainer has not given yet', () => {
    expect(agreement([monday], [labelled(monday.startedAt, 0, null)]).labelled).toBe(0);
  });
});
