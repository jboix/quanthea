import { describe, expect, test } from 'bun:test';
import type { PanelQuery, View } from '@quanthea/shared';
import { eventsConnector } from '../cases/parity.ts';
import type { BuiltPanel, Outcome } from '../checks/dashboard.ts';
import { reportOf } from '../core/test/scoring.ts';
import { evalmarkResult } from './evalmark.ts';
import { htmlReport, markdownReport } from './render.ts';
import { familyRows, parityLine, tallyOf } from './render-parity.ts';
import { summary } from './summary.ts';

/**
 * A panel as a parity question's outcome keeps it, with one search query.
 *
 * @param builder - The data kind the agent asked for.
 * @param view - Its view.
 * @param aggregation - The one aggregation of its query; none by default.
 * @returns The panel.
 */
function panel(builder: string, view: object, aggregation?: object): BuiltPanel {
  const query: PanelQuery = {
    refId: 'A',
    connector: eventsConnector,
    language: 'search',
    index: 'core_events',
    body: { size: 0, aggs: aggregation ? { value: aggregation } : {} },
  };
  return {
    id: 'events',
    title: 'Events',
    connectors: [eventsConnector],
    text: 'Events\n[]',
    queries: [query],
    builder,
    view: view as View,
  };
}

/**
 * A parity question's outcome.
 *
 * @param id - The family's id.
 * @param panels - The panels built.
 * @returns The outcome.
 */
function outcome(id: string, panels: readonly BuiltPanel[]): Outcome {
  const usage = { 'gemini-3.8-flash': { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 } };
  return {
    id,
    built: true,
    panels,
    failing: [],
    repairs: 0,
    asked: [],
    turns: 2,
    usage,
    durationMs: 1000,
  };
}

const stat = { kind: 'stat', ref: 'A' };
const errors = { value_count: { field: 'event_name' } };
const startTime = { percentiles: { field: 'session.qoe_timings.total', percents: [90] } };

/** A panel that answers q9: the refunds by reason, on the dev Postgres. */
const refunds: BuiltPanel = {
  id: 'refunds',
  title: 'Refunds by reason',
  connectors: ['postgres-orders'],
  text: 'Refunds by reason\n[]',
};

/** A fixed run: a dashboard case, one green family, three red ones and two skipped. */
const report = reportOf(
  [
    outcome('q9', [refunds]),
    outcome('f06', [panel('search-stat', stat, errors)]),
    outcome('f07', [panel('search-stat', stat, startTime)]),
    outcome('f10', [panel('raw', { kind: 'table', ref: 'A' })]),
    { ...outcome('f19', []), built: false },
  ],
  [
    { id: 'f23', needs: ['http'] },
    { id: 'f24', needs: ['pinned-target'] },
  ],
);

describe('the parity families of a report', () => {
  const rows = familyRows(report);

  test('has a row per family asked or skipped, by family id, in the families’ order', () => {
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ['f06', 'green'],
      ['f07', 'red'],
      ['f10', 'red'],
      ['f19', 'red'],
      ['f23', 'skipped'],
      ['f24', 'skipped'],
    ]);
    expect(rows[0]?.what).toBe('one number');
  });

  test('a skipped family is not counted as failed', () => {
    expect(tallyOf(rows)).toEqual({ green: 1, red: 3, skipped: 2, errors: 0 });
    expect(parityLine(report)).toBe('Parity: 1 of 4 families green, 3 red, 2 skipped');
    expect(rows[4]).toMatchObject({ shape: 'none', view: 'none', why: 'the world has no http' });
  });

  test('marks the shape and the view apart, on the panel that comes closest', () => {
    const marks = rows.map((row) => [row.id, row.shape, row.view]);
    expect(marks.slice(0, 4)).toEqual([
      ['f06', 'yes', 'yes'],
      ['f07', 'yes', 'no'],
      ['f10', 'no', 'no'],
      ['f19', 'no', 'no'],
    ]);
  });

  test('a view that holds, under data that does not, is marked apart', () => {
    const table = panel('raw', { kind: 'table', ref: 'A' });
    const [row] = familyRows(reportOf([outcome('f11', [table])]));
    expect([row?.shape, row?.view]).toEqual(['no', 'yes']);
  });

  test('a run with no parity question has no family and no score', () => {
    const plain = reportOf([outcome('q9', [refunds])]);
    expect(familyRows(plain)).toEqual([]);
    expect(parityLine(plain)).toBeUndefined();
    expect(markdownReport(plain)).not.toContain('Parity');
  });
});

describe('the report with parity cases', () => {
  test('the summary gives the parity score, and the count of passes leaves the skipped out', () => {
    const text = summary(report);
    expect(text).toContain('Capability: 1 of 4 pass');
    expect(text).toContain('Realistic: 1 of 1 pass');
    expect(text).toContain('Parity: 1 of 4 families green, 3 red, 2 skipped');
  });

  test('the Markdown has the table of families and asks each question in words', () => {
    const markdown = markdownReport(report);
    expect(markdown).toContain('### Parity: 1 of 4 families green, 3 red, 2 skipped');
    expect(markdown).toContain('| f06 | 🟢 green | one number |');
    expect(markdown).toContain('| f23 | ⚪ skipped |');
    expect(markdown).toContain('How many events with event_name ERROR were there');
  });

  test('the HTML page has a row per family, with its verdict', () => {
    const html = htmlReport(report);
    expect(html.match(/<tr data-status="red">/g)).toHaveLength(3);
    expect(html.match(/<tr data-status="skipped">/g)).toHaveLength(2);
    expect(html).toContain('<h1>Evals: 2 of 5 pass</h1>');
  });

  test('the evalmark result holds the parity cases, the skipped ones as skipped trials', () => {
    const cases = evalmarkResult(report).cases;
    expect(cases.map((each) => [each.id, each.trials[0]?.status])).toEqual([
      ['q9', 'pass'],
      ['f06', 'pass'],
      ['f07', 'fail'],
      ['f10', 'fail'],
      ['f19', 'fail'],
      ['f23', 'skip'],
      ['f24', 'skip'],
    ]);
    expect(cases[1]?.tags).toEqual(['dashboard', 'capability', 'parity']);
    expect(cases[5]?.tags).toEqual(['dashboard', 'capability', 'parity']);
    expect(cases[5]?.trials[0]?.output).toBe('f23: skipped, the world has no http connector');
    expect(cases[1]?.input).toContain('event_name ERROR');
  });
});
