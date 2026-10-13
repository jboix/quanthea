/** Every case, in the order a run takes them. */
import type { EvalCase } from '../core/case.ts';
import { alertCases } from './alerts.ts';
import { answerCases } from './answers.ts';
import { dashboardCases } from './dashboards.ts';
import { parityCases } from './parity.ts';
import { reportCases } from './reports.ts';

/** The cases a run takes when `--only` names none. */
export const defaultCases: readonly EvalCase[] = [
  ...dashboardCases,
  ...answerCases,
  ...alertCases,
  ...reportCases,
];

/**
 * The cases a run takes only when `--only` names them: the parity cases cost more than the
 * others and need the search connector.
 */
export const namedCases: readonly EvalCase[] = parityCases;

/** Every case. */
export const allCases: readonly EvalCase[] = [...defaultCases, ...namedCases];
