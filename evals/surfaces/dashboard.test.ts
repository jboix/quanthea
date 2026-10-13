import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, Panel, PanelQuery } from '@quanthea/shared';
import { askedOf } from './asked.ts';
import { panelsOf } from './dashboard.ts';
import type { StoredMessage } from './thread.ts';

/** A search query: events over time, split by their name. */
const eventsOverTime: PanelQuery = {
  refId: 'A',
  connector: 'opensearch-dev',
  language: 'search',
  index: 'core_events',
  body: {
    size: 0,
    aggs: {
      time: {
        date_histogram: { field: '@timestamp', fixed_interval: '5m' },
        aggs: { name: { terms: { field: 'event_name', size: 5 } } },
      },
    },
  },
};

describe('reading the panels built', () => {
  const panel: Panel = {
    id: 'events',
    title: 'Events over time',
    grid: { x: 0, y: 0, w: 12, h: 8 },
    queries: [eventsOverTime],
    view: { kind: 'table', ref: 'A', columns: [{ field: 'time' }] },
  };
  const spec = {
    panels: [panel, { ...panel, id: 'sessions', title: 'Sessions' }],
  } as DashboardSpec;
  const edit = (panels: readonly object[], output: object = { ok: true }): StoredMessage => ({
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [
      { type: 'tool-edit_dashboard', input: { panels }, output } as StoredMessage['parts'][number],
    ],
  });

  test('keeps the queries and the view, and the data kind of the last edit of each panel', () => {
    const messages = [
      edit([
        { title: 'Events over time', data: { kind: 'raw' }, chart: { recipe: 'table' } },
        { title: 'Visits', data: { kind: 'search-stat' }, chart: { recipe: 'stat' } },
      ]),
      edit([{ title: ' events over time ', data: { kind: 'search-series' } }]),
      edit([{ title: 'Sessions', replaces: 'visits', data: { kind: 'search-breakdown' } }]),
    ];
    const [events, sessions] = panelsOf(spec, askedOf(messages));
    expect(events).toMatchObject({ builder: 'search-series', queries: [eventsOverTime] });
    expect(events?.view).toEqual(panel.view);
    expect(events).not.toHaveProperty('recipe');
    expect(events).not.toHaveProperty('operations');
    expect(sessions?.builder).toBe('search-breakdown');
  });

  test('keeps the data kind of the edit that wrote the panel, not of a later failed edit', () => {
    const first = { title: 'Events over time', data: { kind: 'raw' }, chart: { recipe: 'table' } };
    const again = { title: 'Events over time', data: { kind: 'search-series' } };
    const rebuilt = { title: 'Later', replaces: 'events', data: { kind: 'search-stat' } };
    const failed = [edit([first]), edit([again], { ok: false, error: 'The spec is invalid.' })];
    expect(panelsOf(spec, askedOf(failed))[0]).toMatchObject({ builder: 'raw', recipe: 'table' });
    const unanswered = [edit([first]), edit([rebuilt], {}), edit([again], {})];
    expect(panelsOf(spec, askedOf(unanswered))[0]?.builder).toBe('raw');
  });

  test('keeps no data kind of a new panel the write left out', () => {
    const sessions = { title: 'Sessions', data: { kind: 'raw' } };
    const second = { title: 'Sessions', data: { kind: 'search-series' } };
    const other = { title: 'Events over time', data: { kind: 'search-stat' } };
    const leftOut = { ok: true, version: 2, leftOut: { panelIds: ['sessions-2'] } };
    const messages = [edit([sessions]), edit([other, second], leftOut)];
    const [events, built] = panelsOf(spec, askedOf(messages));
    expect(built?.builder).toBe('raw');
    expect(events?.builder).toBe('search-stat');
    const alone = [edit([sessions], { ok: true, leftOut: { panelIds: ['sessions'] } })];
    expect(panelsOf(spec, askedOf(alone))[1]).not.toHaveProperty('builder');
  });

  test('keeps the names of the operations, and no data kind without an edit on record', () => {
    const operations = [{ id: 'B', from: 'A', op: 'pivot' }];
    const withOperations = { panels: [{ ...panel, operations }] } as unknown as DashboardSpec;
    const [built] = panelsOf(withOperations);
    expect(built?.operations).toEqual(['pivot']);
    expect(built).not.toHaveProperty('builder');
  });
});
