import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AnswerEvidence,
  connectorInputSchema,
  dashboardSpecSchema,
  defaultModelGateway,
  type PanelRun,
} from '@quanthea/shared';
import { frameOf } from '../alerts/test/fixtures.ts';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import type { ModelTestResult } from '../gate/test-run.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAnswers } from './answer.ts';
import type { AskRequest } from './answer-types.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

const hour = 3_600_000;
const hours = 4 * 24;
// Four days from midnight UTC, which is 02:00 in Madrid in October.
const range = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-09T00:00:00Z') };

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  // One row per minute from the start of the range, each higher than the one before.
  const config = { rowCount: hours * 60 };
  const input = { name: 'events', kind: 'memory', config, secret: { token: 't' }, accessLevel: 3 };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * A frozen panel run: a count per hour over the range, each higher than the one before.
 *
 * @returns The run.
 */
function frozen(): PanelRun {
  const fields = [
    { name: 'time', type: 'time' as const },
    { name: 'errors', type: 'number' as const },
  ];
  const rows = Array.from({ length: hours }, (_unused, index) => index);
  const frame = frameOf(fields, [rows.map((index) => range.from + index * hour), rows]);
  return {
    time: range,
    queries: [{ refId: 'A', frames: [frame], error: null }],
    markers: [],
    durationMs: 1,
  };
}

/**
 * A question over the range, in a time zone, with a report's frozen run.
 *
 * @param timeZone - The time zone of the question.
 * @returns The request.
 */
function ask(timeZone: string): AskRequest {
  return {
    mode: 'ask',
    dashboardId: null,
    spec: dashboardSpecSchema.parse({ ...eventsSpec(), variables: [] }),
    actor: 'analyst-1',
    signal: AbortSignal.timeout(5000),
    time: range,
    timeZone,
    variables: {},
    question: 'When are errors highest during the day?',
    run: {
      label: 'week 41',
      comparison: null,
      panels: { 'errors-over-time': frozen() },
      comparisonPanels: {},
    },
  };
}

/**
 * Answers the question with one read, and gives the profile of the errors the read recorded.
 *
 * @param tool - The tool that reads.
 * @param timeZone - The time zone of the question.
 * @returns The profile in the evidence, and what the model was sent after the read.
 */
async function profileRead(tool: 'read_data' | 'read_run', timeZone: string) {
  const script: ScriptedStep[] = [
    { tool, input: { panelId: 'errors-over-time' } },
    { tool: 'give_answer', input: { text: 'Late [1].', citations: [{ n: 1, evidenceId: 'e1' }] } },
  ];
  const model = scriptedStreamModel(...script);
  const answers = createAnswers({ ...services, buildModel: () => model });
  const outcome = await answers.answer(ask(timeZone));
  const evidence: AnswerEvidence | undefined = outcome.ok ? outcome.answer.evidence[0] : undefined;
  const result = evidence?.result as ModelTestResult | undefined;
  const summaries = result?.ok ? result.frames?.[0]?.summaries : undefined;
  const errors = summaries?.find((summary) => summary.field === 'errors');
  const profile = errors?.type === 'number' ? errors.profile : undefined;
  return { profile, seen: JSON.stringify(model.doStreamCalls[1]?.prompt) };
}

describe('a read profiles its numbers on the clock of the question', () => {
  for (const tool of ['read_data', 'read_run'] as const) {
    test(`${tool} passes the time zone to the gate`, async () => {
      const madrid = await profileRead(tool, 'Europe/Madrid');
      expect(madrid.profile?.timeZone).toBe('Europe/Madrid');
      // The series starts at 02:00 in Madrid: three whole days there, each highest at 23:00.
      expect(madrid.profile?.peakHour).toEqual({ days: 3, hours: [{ hour: 23, days: 3 }] });
      expect(madrid.seen).toContain('"profile":{"timeZone":"Europe/Madrid"');
    });

    test(`${tool} counts the days of another zone differently`, async () => {
      const utc = await profileRead(tool, 'UTC');
      expect(utc.profile?.timeZone).toBe('UTC');
      expect(utc.profile?.peakHour).toEqual({ days: 4, hours: [{ hour: 23, days: 4 }] });
    });
  }
});
