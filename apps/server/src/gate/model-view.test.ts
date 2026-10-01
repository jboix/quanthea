import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = {
    name: 'events',
    kind: 'memory',
    config: {},
    secret: { token: 't' },
    hiddenFields: ['events.errors'],
  };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

const signal = () => AbortSignal.timeout(2000);
const timeRange = { from: new Date(0), to: new Date(3_600_000) };

describe('the model view of the connectors', () => {
  test('lists connectors with their language, dialect and what their level shows', () => {
    expect(services.modelView.connectors()).toEqual([
      {
        name: 'events',
        kind: 'memory',
        language: 'sql',
        dialect: 'postgres',
        accessLevel: 2,
        access:
          'level 2, schema and metadata: test runs return shapes and row counts, never values',
      },
    ]);
  });

  test('describes a schema without its hidden fields, cut to a scope', async () => {
    const described = await services.modelView.describe('events', undefined, signal());
    expect(described.ok && described.entities[0]?.fields.map((field) => field.name)).toEqual([
      'time',
      'service',
    ]);
    expect(await services.modelView.describe('events', 'nothing', signal())).toEqual({
      ok: true,
      entities: [],
      more: 0,
    });
    expect(await services.modelView.describe('missing', undefined, signal())).toMatchObject({
      ok: false,
    });
  });

  test('samples values, and never a hidden field', async () => {
    const sampled = await services.modelView.sample(
      'events',
      { entity: 'events', field: 'service' },
      10,
      signal(),
    );
    expect(sampled).toEqual({ ok: true, values: ['checkout-svc', 'payments-svc', 'cart-svc'] });
    const hidden = await services.modelView.sample(
      'events',
      { entity: 'events', field: 'errors' },
      10,
      signal(),
    );
    expect(hidden).toEqual({ ok: false, error: 'events.errors is hidden.' });
  });

  test('test-runs a query and returns its shape, not its values, at level 2', async () => {
    const template = { language: 'sql' as const, sql: 'SELECT * FROM events' };
    const result = await services.modelView.testQuery('events', {
      refId: 'A',
      template,
      variables: {},
      timeRange,
    });
    expect(result).toEqual({
      ok: true,
      frames: [
        {
          fields: [
            { name: 'time', type: 'time' },
            { name: 'service', type: 'string' },
          ],
          rowCount: 5,
          truncated: false,
        },
      ],
    });
    const unknown = await services.modelView.testQuery('nowhere', {
      refId: 'A',
      template,
      variables: {},
      timeRange,
    });
    expect(unknown).toEqual({
      ok: false,
      error: 'Cannot use connector "nowhere": it does not exist or cannot be reached.',
    });
  });

  test('passes a panel error through, and shapes panel frames by level', () => {
    expect(
      services.modelView.panelResult('events', { frames: [], error: 'Unknown query.' }),
    ).toEqual({ ok: false, error: 'Unknown query.' });
    expect(services.modelView.panelResult('events', { frames: [], error: null })).toEqual({
      ok: true,
      frames: [],
    });
  });
});
