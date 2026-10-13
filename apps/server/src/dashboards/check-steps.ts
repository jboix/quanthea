/**
 * Checks the mappings of a chart view. Among the charts only a gauge takes them, as the steps
 * that colour its dial, and a step is a range with a tone: a dial draws no text and places no
 * single value.
 */
import { isStep, type View } from '@quanthea/shared';
import type { SpecIssue } from './issues.ts';

/** What is said of mappings on a chart that is not a gauge. */
const notGauge =
  'Among the charts only a gauge (kpi.gauge) takes "mappings", the steps of its dial. A table column and a stat take them too.';

/** What is said of a gauge's mapping that is not a step. */
const notStep =
  'A step of a gauge is a range with a tone, such as { "match": { "from": 0.9 }, "tone": "bad" }.';

/**
 * Checks the mappings of one view.
 *
 * @param view - The view.
 * @param path - Its path, such as `panels[1].view`.
 * @returns The issues: mappings on a chart that is not a gauge, or a mapping that is not a step.
 */
export function checkSteps(view: View, path: string): SpecIssue[] {
  if (view.kind !== 'chart' || view.mappings === undefined) return [];
  if (view.prepare !== 'gauge') return [{ path: `${path}.mappings`, message: notGauge }];
  return view.mappings.flatMap((mapping, index) =>
    isStep(mapping) ? [] : [{ path: `${path}.mappings[${index}]`, message: notStep }],
  );
}
