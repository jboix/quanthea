import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, queryBuilders, type SavedQuery } from '@querent/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { previewPanel } from './recipe-preview.ts';
import { builderGuides } from './recipes/guide.ts';

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
  show: 'table',
  unit: 'number',
  columns: ['time', 'level'],
};

describe('previewPanel', () => {
  test('expands a draft recipe, runs it, and returns the panel and its queries', async () => {
    const panel = { recipe: 'saved', name: 'all-events', connector: 'events', params: {} };
    const unfilled = await previewPanel(services.dashboards, panel, [allEvents]);
    expect(unfilled).toMatchObject({ ok: false, message: 'All events needs a value for table.' });
    const filled = { ...panel, params: { table: 'events' } };
    const preview = await previewPanel(services.dashboards, filled, [allEvents]);
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.queries).toEqual(['SELECT * FROM "events"']);
    expect(preview.panel.view.kind).toBe('table');
    expect(preview.run.queries).toHaveLength(1);
  });

  test('says what is wrong with a request, and what the connector refused', async () => {
    const unknown = await previewPanel(services.dashboards, { recipe: 'nope' }, []);
    expect(unknown.ok).toBe(false);
    const stat = { recipe: 'sql-stat', connector: 'events', table: 'events' };
    const refused = await previewPanel(services.dashboards, stat, []);
    expect(refused).toMatchObject({
      ok: true,
      queries: ['SELECT count(*) AS value FROM "events"'],
    });
    expect(refused.ok && refused.run.queries[0]?.error?.message).toBe('Unknown query.');
  });
});

describe('builderGuides', () => {
  test('describe every built-in recipe with its fields and the queries its example writes', () => {
    const guides = builderGuides();
    expect(guides.map((guide) => guide.id)).toEqual(queryBuilders.map((recipe) => recipe.id));
    const rate = guides.find((guide) => guide.id === 'rate');
    expect(rate?.fields.find((field) => field.name === 'window')).toMatchObject({
      required: false,
      default: '$__rate_interval',
    });
    expect(rate?.queries).toEqual([
      'sum by (code) (rate(http_requests_total{service="$service"}[$__rate_interval]))',
    ]);
  });
});
