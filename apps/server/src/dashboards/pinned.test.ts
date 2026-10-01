import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { eventsSpec } from './test/events-spec.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let pinnedId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: { rowCount: 5 }, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  ({ id: pinnedId } = services.dashboards.create(eventsSpec(), 'first', 'editor-1'));
  await services.dashboards.pin(pinnedId, 1, 'editor-1');
  services.dashboards.create({ ...eventsSpec(), title: 'Events draft' }, 'draft', 'editor-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

describe('pinned dashboards found with no model', () => {
  test('match a question by title, panels and connectors, and never a draft', () => {
    expect(services.dashboards.findPinned('What are the events errors today?')).toEqual([
      {
        dashboardId: pinnedId,
        title: 'Events',
        version: 1,
        panels: ['Errors · peak', 'Errors over time'],
      },
    ]);
  });

  test('match nothing for an unrelated question', () => {
    expect(services.dashboards.findPinned('Revenue by country')).toEqual([]);
    expect(services.dashboards.findPinned('What happened yesterday?')).toEqual([]);
  });

  test('copy into a new dashboard that records where it came from', () => {
    const copy = services.dashboards.copyPinned(pinnedId, 'editor-1');
    expect(copy).toMatchObject({ version: 1, title: 'Events' });
    const detail = services.dashboards.get(copy.dashboardId, 'editor');
    expect(detail).toMatchObject({
      parentDashboardId: pinnedId,
      parentVersion: 1,
      pinnedVersion: null,
    });
    expect(detail.versions[0]?.changeSummary).toBe('Copied from "Events" v1');
  });

  test('copy only a pinned dashboard', () => {
    expect(() => services.dashboards.copyPinned('nope', 'editor-1')).toThrow(
      'No pinned dashboard nope.',
    );
  });
});
