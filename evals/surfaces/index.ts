/**
 * The surfaces a case can act on: how each acts, and the structure checks each runs before a
 * case's own.
 */
import { alertDefaults } from '../checks/alert.ts';
import { answerDefaults } from '../checks/answer.ts';
import { dashboardDefaults } from '../checks/dashboard.ts';
import { reportDefaults } from '../checks/report.ts';
import { runAnswerDefaults } from '../checks/run-answer.ts';
import type { Check, EvalCase, Evidence, EvidenceOf, Given, SurfaceName } from '../core/case.ts';
import type { Acted } from '../core/result.ts';
import type { EvalWorld } from '../world/setup.ts';
import { actAlert } from './alert.ts';
import { actAnswer, actExplanation } from './answer.ts';
import { actDashboard } from './dashboard.ts';
import { actReport } from './report.ts';
import { actRunAnswer } from './run-answer.ts';

/** The structure checks of each surface. */
const defaults: { readonly [Surface in SurfaceName]: readonly Check<EvidenceOf<Surface>>[] } = {
  dashboard: dashboardDefaults,
  alert: alertDefaults,
  report: reportDefaults,
  answer: answerDefaults,
  explanation: answerDefaults,
  'run-answer': runAnswerDefaults,
};

/**
 * The checks of a case, in order: its surface's own, without those it leaves out, then its own.
 *
 * @param evalCase - The case.
 * @returns The checks.
 */
export function checksOf(evalCase: EvalCase): readonly Check<Evidence>[] {
  const own = defaults[evalCase.input.surface] as readonly Check<Evidence>[];
  const kept = own.filter((check) => !(evalCase.without ?? []).includes(check.id));
  return [...kept, ...(evalCase.checks as readonly Check<Evidence>[])];
}

/**
 * Acts a case's input on its surface.
 *
 * @param world - The world, with the case's fixture in it.
 * @param given - What the fixture left.
 * @param evalCase - The case.
 * @returns The evidence and the tool calls.
 */
export function act(world: EvalWorld, given: Given, evalCase: EvalCase): Promise<Acted<Evidence>> {
  const { id, input } = evalCase;
  if (input.surface === 'dashboard') return actDashboard(world, given, input, id);
  if (input.surface === 'alert') return actAlert(world, given, input, id);
  if (input.surface === 'report') return actReport(world, given, input, id);
  if (input.surface === 'answer') return actAnswer(world, given, input, id);
  if (input.surface === 'explanation') return actExplanation(world, given, input, id);
  return actRunAnswer(world, given, input, id);
}

/**
 * What a case made when it could not even start, such as a fixture that failed: nothing, and why.
 *
 * @param evalCase - The case.
 * @param error - Why it failed.
 * @returns The evidence of its surface, empty, with the error.
 */
export function erred(evalCase: EvalCase, error: string): Evidence {
  const { id, input } = evalCase;
  const spent = { usage: {}, durationMs: 0, error };
  const thread = { versions: 0, channelIds: [], toolCalls: {}, said: '', asked: [], repairs: 0 };
  if (input.surface === 'dashboard')
    return { id, built: false, panels: [], failing: [], repairs: 0, asked: [], turns: 0, ...spent };
  if (input.surface === 'alert')
    return { kind: 'alert', id, incidentAt: 0, ...thread, turns: 0, ...spent };
  if (input.surface === 'report') return { kind: 'report', id, ...thread, turns: 0, ...spent };
  if (input.surface === 'run-answer') return { kind: 'run-answer', id, answers: [], ...spent };
  const none = { ok: false, citations: [], evidence: [], toolCalls: {}, steps: 0 };
  return { kind: 'answer', id, ...none, ...spent };
}
