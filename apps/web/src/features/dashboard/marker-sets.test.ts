import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema } from '@quanthea/shared';
import {
  hiddenMarkersOf,
  markerColorVar,
  markerSetsOf,
  runSearchOf,
  shownMarkers,
  withMarkersShown,
} from './marker-sets.ts';

/**
 * A set of markers.
 *
 * @param id - Its id.
 * @param color - Its colour token.
 * @returns The annotation.
 */
function set(id: string, color?: string) {
  const query = { refId: 'M', connector: 'shop', language: 'sql', sql: 'SELECT 1' };
  return {
    id,
    label: id,
    ...(color ? { color } : {}),
    query,
    timeField: 'time',
    textField: 'text',
  };
}

const spec: DashboardSpec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'T',
  time: { from: 'now-6h', to: 'now' },
  annotations: [set('deploys'), set('incidents', '@palette.5'), set('unused', '@palette.0')],
  panels: [
    {
      id: 'errors',
      title: 'Errors',
      grid: { x: 0, y: 0, w: 12, h: 8 },
      queries: [{ refId: 'A', connector: 'prom', language: 'promql', expr: 'up' }],
      view: {
        kind: 'chart',
        prepare: 'cartesian',
        roles: {},
        option: { xAxis: { type: 'time' }, series: [{ type: 'line' }] },
        datasets: [{ ref: 'A' }],
        markers: [{ annotation: 'deploys' }, { annotation: 'incidents' }],
      },
    },
  ],
});

describe('sets of markers in the view', () => {
  test('lists the sets some chart shows, in the dashboard order', () => {
    expect(markerSetsOf(spec).map((each) => each.id)).toEqual(['deploys', 'incidents']);
  });

  test('hides and shows a set through the URL, keeping the other choices', () => {
    const hidden = withMarkersShown(new URLSearchParams('var-env=prod'), 'deploys', false);
    expect(hidden.toString()).toBe('var-env=prod&hide-markers=deploys');
    const both = withMarkersShown(hidden, 'incidents', false);
    expect([...hiddenMarkersOf(both, spec)]).toEqual(['deploys', 'incidents']);
    const shownAgain = withMarkersShown(both, 'deploys', true);
    expect([...hiddenMarkersOf(shownAgain, spec)]).toEqual(['incidents']);
  });

  test('ignores ids of no set, and runs the panels without the hidden sets', () => {
    const search = new URLSearchParams('from=now-1h&to=now&hide-markers=nope&hide-markers=deploys');
    expect([...hiddenMarkersOf(search, spec)]).toEqual(['deploys']);
    expect(runSearchOf(search)).toBe('from=now-1h&to=now');
  });

  test('keeps the firing periods of a linked alert hidden, like a set', () => {
    const search = withMarkersShown(new URLSearchParams(), 'alert:01ALERT', false);
    expect(search.toString()).toBe('hide-markers=alert%3A01ALERT');
    expect([...hiddenMarkersOf(search, spec)]).toEqual(['alert:01ALERT']);
    expect(runSearchOf(search)).toBe('');
  });

  test('draws no marker of a hidden set', () => {
    const outcome = (annotation: string) => ({
      annotation,
      label: annotation,
      color: '@ink' as const,
      points: [{ time: 0, text: annotation }],
      error: null,
    });
    const markers = [outcome('deploys'), outcome('incidents')];
    const hidden = hiddenMarkersOf(new URLSearchParams('hide-markers=incidents'), spec);
    expect(shownMarkers(markers, hidden).map((each) => each.annotation)).toEqual(['deploys']);
    expect(shownMarkers(markers, undefined)).toEqual(markers);
  });

  test('draws each colour token from the stylesheet the charts read', () => {
    expect(markerColorVar(undefined)).toBe('var(--color-ink)');
    expect(markerColorVar('@ink')).toBe('var(--color-ink)');
    expect(markerColorVar('@palette.0')).toBe('var(--color-accent)');
    expect(markerColorVar('@palette.5')).toBe('var(--color-series-6)');
  });
});
