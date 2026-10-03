import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type DashboardSpec, dashboardSpecSchema } from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import type { ModelStep } from '../usage/usage.ts';
import { cleanTags, createMetadataWriter } from './metadata.ts';
import { scriptedModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

const spec: DashboardSpec = dashboardSpecSchema.parse(eventsSpec());

describe('the metadata model at pin time', () => {
  test('cleans tags into a few lowercase words', () => {
    expect(
      cleanTags(['#Checkout', 'p95 Latency', 'checkout', 'x', 'a', 'b1', 'c2', 'd3', 'e4']),
    ).toEqual(['checkout', 'p95-latency', 'b1', 'c2', 'd3', 'e4']);
  });

  test('writes a description and tags, and records the tokens against the thread', async () => {
    const steps: ModelStep[] = [];
    const answer = { description: 'Errors of each service.', tags: ['Errors', 'services'] };
    const write = createMetadataWriter({
      modelSettings: services.modelSettings,
      usage: { recordStep: (step) => steps.push(step) },
      buildModel: () => scriptedModel({ text: JSON.stringify(answer) }),
    });
    const written = await write({ spec, threadId: 'thread-1', providerId: null });
    expect(written).toEqual({
      description: 'Errors of each service.',
      tags: ['errors', 'services'],
    });
    expect(steps).toMatchObject([{ threadId: 'thread-1', job: 'metadata', feature: 'building' }]);
  });

  test('gives nothing when the model fails, and pinning goes on without tags', async () => {
    const write = createMetadataWriter({
      modelSettings: services.modelSettings,
      usage: services.usage,
      buildModel: () => scriptedModel({ text: 'not json' }),
    });
    expect(await write({ spec, threadId: null, providerId: null })).toBeNull();
    const { id } = services.dashboards.create(eventsSpec(), 'first', 'editor-1');
    const pinned = await services.dashboards.pin(id, 1, 'editor-1', () =>
      write({ spec, threadId: null, providerId: null }),
    );
    expect(pinned).toMatchObject({ pinnedVersion: 1, tags: [], description: 'Errors by service.' });
  });

  test('fills the tags, and the description only where the spec has none', async () => {
    const { description: _description, ...bare } = eventsSpec();
    const { id } = services.dashboards.create(bare, 'first', 'editor-1');
    const describe = async () => ({ description: 'Written by the model.', tags: ['events'] });
    const pinned = await services.dashboards.pin(id, 1, 'editor-1', describe);
    expect(pinned).toMatchObject({ description: 'Written by the model.', tags: ['events'] });
  });
});
