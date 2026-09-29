import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type SavedQuery } from '@querent/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { previewData } from './query-preview.ts';

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

const allEvents: SavedQuery = {
  id: 'all-events',
  name: 'All events',
  description: 'Every event.',
  language: 'sql',
  query: 'SELECT * FROM {{table}}',
  params: [{ name: 'table', kind: 'table', description: '' }],
  shape: 'rows',
};

/**
 * Previews a data request over the last day.
 *
 * @param data - The data request.
 * @param chart - The chart, if one is named.
 * @returns The preview.
 */
function preview(data: Record<string, unknown>, chart?: Record<string, unknown>) {
  return previewData(services.dashboards, { data, chart, saved: [allEvents], from: 'now-24h' });
}

describe('previewData', () => {
  test('builds a draft saved query, runs it, and draws it with the chart that suits its shape', async () => {
    const data = { kind: 'saved', name: 'all-events', connector: 'events', params: {} };
    expect(await preview(data)).toMatchObject({
      ok: false,
      message: 'All events needs a value for table.',
    });
    const drawn = await preview({ ...data, params: { table: 'events' } });
    if (!drawn.ok) throw new Error(drawn.message);
    expect(drawn.queries).toEqual(['SELECT * FROM "events"']);
    expect(drawn.panel.view.kind).toBe('table');
    expect(drawn.columns.length).toBeGreaterThan(1);
  });

  test('draws with the chart named, its roles taken from the result', async () => {
    const data = {
      kind: 'raw',
      connector: 'events',
      language: 'sql',
      query: 'SELECT * FROM events',
    };
    const drawn = await preview(data, { recipe: 'trend.line' });
    if (!drawn.ok) throw new Error(drawn.message);
    expect(drawn.panel.view).toMatchObject({ kind: 'chart', recipe: { id: 'trend.line' } });
    expect(drawn.panel.view.kind === 'chart' && drawn.panel.view.roles.x).toBe('time');
  });

  test('says what is wrong with a request, and what the connector refused', async () => {
    expect((await preview({ kind: 'nope' })).ok).toBe(false);
    const refused = await preview({ kind: 'sql-stat', connector: 'events', table: 'events' });
    expect(refused).toMatchObject({
      ok: false,
      message: 'Unknown query.',
      queries: ['SELECT count(*) AS value FROM "events"'],
    });
  });
});
