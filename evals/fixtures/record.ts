/**
 * Records a fixture again from a live run of the case it stands for (`--record`): the case runs
 * once, and when it passes, what it saved replaces the fixture's file. The maintainer reads the
 * diff before keeping it, and may edit the file by hand: a recording is one sample, and a fixture
 * should be the right one.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertPlanSchema, reportPlanSchema } from '@quanthea/shared';
import { allCases } from '../cases/index.ts';
import { isAlert } from '../checks/alert.ts';
import { isReport } from '../checks/report.ts';
import type { TrialResult } from '../core/result.ts';
import { type RunSetup, runTrial } from '../core/runner.ts';
import { channelAlias, type RecordingName, recordings } from './saved-thread.ts';

/** The case each recording is made from, and the tool whose input is its plan. */
const sources: Readonly<Record<RecordingName, { case: string; planTool: string }>> = {
  'alert-checkout-share': { case: 'al1', planTool: 'propose_alert' },
  'report-daily-orders': { case: 'r1', planTool: 'propose_report' },
};

/**
 * The plan a trial's agent proposed last, read from its tool calls.
 *
 * @param trial - The trial.
 * @param name - The recording.
 * @returns The plan, checked; the plan the fixture already holds when the trace has none to read.
 */
function planOf(trial: TrialResult, name: RecordingName): unknown {
  const { kind, data } = recordings[name];
  const call = trial.trace.toolCalls.findLast((each) => each.tool === sources[name].planTool);
  try {
    const body = { ...(JSON.parse(call?.input ?? '') as object), kind };
    return (kind === 'alert' ? alertPlanSchema : reportPlanSchema).parse(body);
  } catch {
    return data.plan;
  }
}

/**
 * What the agent said last in a trial: the last line of what it said that is not a refusal note.
 *
 * @param said - What the agent said, line after line.
 * @returns The line.
 */
function lastSaid(said: string): string {
  const lines = said.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('['));
  return lines.at(-1) ?? '';
}

/**
 * A recording's file, from a trial that passed.
 *
 * @param trial - The trial.
 * @param name - The recording.
 * @param ask - What the person asked.
 * @returns The file's text, with the world's channel written as its alias.
 * @throws {Error} When the trial saved nothing to record.
 */
function fileOf(trial: TrialResult, name: RecordingName, ask: string): string {
  const { evidence } = trial;
  if (!(isAlert(evidence) || isReport(evidence)) || !evidence.spec)
    throw new Error('The run saved nothing to record.');
  const recorded = {
    ask,
    said: lastSaid(evidence.said),
    plan: planOf(trial, name),
    spec: evidence.spec,
  };
  let text = JSON.stringify(recorded, null, 2);
  for (const id of evidence.channelIds) text = text.replaceAll(id, channelAlias);
  return `${text}\n`;
}

/**
 * Runs the case a fixture stands for and, when it passes, rewrites the fixture's file.
 *
 * @param name - The recording's name.
 * @param setup - The run's setup.
 * @param dir - The fixtures' folder.
 * @returns What happened, in a sentence.
 * @throws {Error} When no recording has the name, or the case did not pass.
 */
export async function record(name: string, setup: RunSetup, dir: string): Promise<string> {
  if (!(name in recordings))
    throw new Error(`No recording ${name}. There are: ${Object.keys(recordings).join(', ')}.`);
  const recording = name as RecordingName;
  const evalCase = allCases.find((each) => each.id === sources[recording].case);
  if (!evalCase) throw new Error(`The case ${sources[recording].case} is gone.`);
  const trial = await runTrial(evalCase, setup, 1);
  if (trial.status !== 'pass')
    throw new Error(`${evalCase.id} did not pass (${trial.status}): nothing was recorded.`);
  const path = join(dir, `${name}.json`);
  writeFileSync(path, fileOf(trial, recording, evalCase.input.turns[0] ?? ''));
  return `Recorded ${path} from ${evalCase.id}. Read the diff before keeping it.`;
}
