import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  connectorInputSchema,
  type DashboardSpec,
  dashboardSpecSchema,
  defaultModelGateway,
} from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAnswers } from './answer.ts';
import { scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(
    connectorInputSchema.parse({ ...input, accessLevel: 4 }),
    'admin-1',
  );
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The events spec, its first panel appending a second query to its first.
 *
 * @returns The spec.
 */
function spec(): DashboardSpec {
  const base = eventsSpec();
  const [first] = base.panels;
  const query = first?.queries[0];
  const panel = {
    ...first,
    queries: [query, { ...query, refId: 'B' }],
    operations: [{ op: 'append', with: 'B' }],
  };
  return dashboardSpecSchema.parse({ ...base, panels: [panel, ...base.panels.slice(1)] });
}

test("Ask reads the table a panel's operations make, and records them as the evidence", async () => {
  const panelId = spec().panels[0]?.id ?? '';
  const model = scriptedStreamModel(
    { tool: 'read_data', input: { panelId } },
    {
      tool: 'give_answer',
      input: { text: 'Errors doubled [1].', citations: [{ n: 1, evidenceId: 'e1', panelId }] },
    },
  );
  const usage = { recordStep: () => undefined };
  const answers = createAnswers({ ...services, usage, buildModel: () => model });
  const outcome = await answers.answer({
    mode: 'ask',
    dashboardId: 'd1',
    spec: spec(),
    actor: 'viewer-1',
    signal: AbortSignal.timeout(5000),
    time: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') },
    timeZone: 'UTC',
    variables: {},
    question: 'Did errors double?',
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const [evidence] = outcome.answer.evidence;
  const query = evidence?.query as { queries?: unknown[]; operations?: unknown[] } | undefined;
  expect(query?.operations).toEqual([{ op: 'append', with: 'B' }]);
  expect(query?.queries).toHaveLength(2);
  const read = JSON.stringify(evidence?.result);
  expect(read).toContain('"rowCount":');
});
