import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { eventsSpec } from './test/events-spec.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let eventsId = '';
let checkoutId = '';

/**
 * The events spec as a checkout dashboard, whose panels are about latency.
 *
 * @returns The spec.
 */
function checkoutSpec() {
  const spec = eventsSpec();
  const titles = ['Latency · peak', 'Latency over time'];
  const panels = spec.panels.map((panel, index) => ({ ...panel, title: titles[index] ?? 'Rows' }));
  return { ...spec, title: 'Checkout', description: 'How slow checkout is.', panels };
}

/**
 * Searches the library with no filters.
 *
 * @param q - The search.
 * @returns The results.
 */
function search(q?: string) {
  return services.dashboards.searchLibrary({ q, tags: [], connectors: [] }).results;
}

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: { rowCount: 5 }, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  ({ id: eventsId } = services.dashboards.create(eventsSpec(), 'first', 'editor-1'));
  await services.dashboards.pin(eventsId, 1, 'editor-1');
  ({ id: checkoutId } = services.dashboards.create(checkoutSpec(), 'first', 'editor-1'));
  await services.dashboards.pin(checkoutId, 1, 'editor-1');
  services.dashboards.create({ ...eventsSpec(), title: 'Events draft' }, 'draft', 'editor-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

describe('the library', () => {
  test('lists every pinned dashboard with no search, and never a draft', () => {
    const outcome = services.dashboards.searchLibrary({ tags: [], connectors: [] });
    expect(outcome.results.map((entry) => entry.title).sort()).toEqual(['Checkout', 'Events']);
    expect(outcome.results[0]).toMatchObject({ version: 1, connectors: ['events'], panels: [] });
    expect(outcome.connectors).toEqual(['events']);
  });

  test('finds the panels that match, by stem and by prefix', () => {
    const [events, ...rest] = search('errors');
    expect(rest).toEqual([]);
    expect(events?.dashboardId).toBe(eventsId);
    expect(events?.panels.map((panel) => panel.id).sort()).toEqual([
      'errors-over-time',
      'errors-peak',
    ]);
    expect(events?.preview?.id).toBe(events?.panels[0]?.id);
    expect(search('laten').map((entry) => entry.dashboardId)).toEqual([checkoutId]);
  });

  test('matches words spread over a dashboard and one of its panels', () => {
    const [checkout] = search('checkout peak');
    expect(checkout?.dashboardId).toBe(checkoutId);
    expect(checkout?.panels).toEqual([
      { id: 'errors-peak', title: 'Latency · peak', description: null },
    ]);
    expect(search('checkout revenue')).toEqual([]);
  });

  test('reads a search with FTS syntax as plain words', () => {
    expect(() => search('"AND (NEAR* OR')).not.toThrow();
    expect(search('events:errors')[0]?.dashboardId).toBe(eventsId);
  });

  test('filters by connector and tag', () => {
    const filter = (tags: string[], connectors: string[]) =>
      services.dashboards.searchLibrary({ tags, connectors }).results.length;
    expect(filter([], ['events'])).toBe(2);
    expect(filter([], ['prometheus'])).toBe(0);
    expect(filter(['payments'], [])).toBe(0);
  });

  test('follows a newly pinned version, and names the parent of a copy', async () => {
    services.dashboards.addVersion(eventsId, { ...eventsSpec(), title: 'Incidents' }, 'v2', 'e');
    await services.dashboards.pin(eventsId, 2, 'editor-1');
    expect(search('incidents').map((entry) => entry.dashboardId)).toEqual([eventsId]);
    const copy = services.dashboards.copyPinned(checkoutId, 'editor-1');
    await services.dashboards.pin(copy.dashboardId, 1, 'editor-1');
    const entry = search('checkout').find((each) => each.dashboardId === copy.dashboardId);
    expect(entry?.parent).toEqual({ dashboardId: checkoutId, title: 'Checkout' });
  });
});
