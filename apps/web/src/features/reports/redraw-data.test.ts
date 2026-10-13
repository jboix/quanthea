import { describe, expect, test } from 'bun:test';
import type { PanelRun, ReportRunDetail } from '@quanthea/shared';
import { drawnPanels, redrawChoices, redrawPath } from './redraw-data.ts';

const week = { from: Date.parse('2026-09-21T00:00:00Z'), to: Date.parse('2026-09-28T00:00:00Z') };

/**
 * A run of a report with one panel.
 *
 * @param kind - The panel's view.
 * @param sql - Its query.
 * @returns The run, as far as the choices read it.
 */
function runWith(kind: 'chart' | 'stat', sql: string): ReportRunDetail {
  const queries = [{ refId: 'A', connector: 'orders', language: 'sql', sql }];
  const spec = { panels: [{ id: 'p', view: { kind }, queries }] };
  return { spec, period: { ...week, label: 'week 39' } } as unknown as ReportRunDetail;
}

/**
 * A panel's run with a marker of which it is.
 *
 * @param durationMs - The marker.
 * @returns The run.
 */
const panelRun = (durationMs: number) => ({ durationMs }) as PanelRun;

describe('the intervals a run offers', () => {
  test('are those of its period when a chart follows the interval', () => {
    const run = runWith('chart', 'SELECT date_bin(:__interval::interval, t, :__from) AS time');
    expect(redrawChoices(run)).toEqual(['10m', '30m', '1h', '6h', '1d']);
  });

  test('are none when every chart names a fixed step', () => {
    expect(redrawChoices(runWith('chart', "SELECT date_trunc('minute', t) AS time"))).toEqual([]);
  });

  test('are none for numbers, which keep what the run stored', () => {
    expect(redrawChoices(runWith('stat', 'SELECT :__interval AS width'))).toEqual([]);
  });
});

describe('what a run draws', () => {
  test('is what it stored until an interval is chosen', () => {
    const stored = { trend: panelRun(1), revenue: panelRun(2) };
    expect(drawnPanels(stored, undefined)).toBe(stored);
  });

  test('is the charts drawn again, with the stored numbers beside them', () => {
    const stored = { trend: panelRun(1), revenue: panelRun(2) };
    const redraw = { interval: '6h' as const, panels: { trend: panelRun(3) } };
    expect(drawnPanels(stored, redraw)).toEqual({ trend: panelRun(3), revenue: panelRun(2) });
  });

  test('is asked for by run and by interval, never by query', () => {
    expect(redrawPath('r 1', 'run', '1h')).toBe('/reports/r%201/runs/run/redraw?interval=1h');
  });
});
