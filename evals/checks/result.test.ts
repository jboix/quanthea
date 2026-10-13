import { describe, expect, test } from 'bun:test';
import type { Truth } from '../core/case.ts';
import { scored } from '../core/test/scoring.ts';
import type { PanelResult, QuerySummary } from '../surfaces/panel-results.ts';
import type { Outcome } from './dashboard.ts';
import { near, showsNumber, totalsMatch } from './result.ts';

const errors: Truth<number> = { key: 'errors', compute: async () => 312 };
const byName: Truth<Record<string, number>> = { key: 'byName', compute: async () => ({}) };

/**
 * One query's result.
 *
 * @param more - What it holds.
 * @returns The result.
 */
function query(more: Partial<QuerySummary>): QuerySummary {
  return { refId: 'A', columns: [], rowCount: 0, rows: [], truncated: false, ...more };
}

/**
 * A built dashboard with some panel results.
 *
 * @param results - What each panel returned.
 * @returns The evidence.
 */
function built(results: readonly PanelResult[]): Outcome {
  const made = { id: 'f06', built: true, panels: [], failing: [], repairs: 0, asked: [] };
  return { ...made, turns: 1, usage: {}, durationMs: 1, results };
}

describe('how near a number is to the truth', () => {
  test('within a share of the truth, or within an amount in its unit', () => {
    expect(near(312, 312, {})).toBe(true);
    expect(near(313, 312, {})).toBe(false);
    expect(near(313, 312, { relative: 0.005 })).toBe(true);
    expect(near(320, 312, { relative: 0.005 })).toBe(false);
    expect(near(0.929, 0.928, { absolute: 0.002 })).toBe(true);
    expect(near(0.94, 0.928, { absolute: 0.002 })).toBe(false);
  });

  test('in any unit the case allows, with the amount scaled to it', () => {
    const either = { relative: 0.02, scales: [1, 0.001] };
    expect(near(2242.8, 2242.8, either)).toBe(true);
    expect(near(2.24, 2242.8, either)).toBe(true);
    expect(near(22.4, 2242.8, either)).toBe(false);
    expect(near(92.8, 0.928, { absolute: 0.002, scales: [1, 100] })).toBe(true);
  });
});

describe('a panel shows the number the data holds', () => {
  const check = showsNumber(errors, { relative: 0.005 });

  test('a stat that shows it passes, however its query is written', () => {
    const stat = {
      panelId: 'errors',
      queries: [query({ rowCount: 1, rows: [[312]] })],
      shown: 312,
    };
    expect(scored([check], built([stat]), { errors: 312 }).reasons).toEqual([]);
  });

  test('a gauge or a table of one row counts: every number of the row is read', () => {
    const gauge = { panelId: 'g', queries: [query({ rowCount: 1, rows: [['all', 5, 312]] })] };
    expect(scored([check], built([gauge]), { errors: 312 }).pass).toBe(true);
  });

  test('a panel with the right words and the wrong number fails, and says what it shows', () => {
    const stat = {
      panelId: 'errors',
      queries: [query({ rowCount: 1, rows: [[4320]] })],
      shown: 4320,
    };
    expect(scored([check], built([stat]), { errors: 312 }).reasons).toEqual([
      'no panel shows errors = 312: the panels show 4320, 4320',
    ]);
  });

  test('a series is not one number', () => {
    const series = { panelId: 's', queries: [query({ rowCount: 24, rows: [[1, 312]] })] };
    expect(scored([check], built([series]), { errors: 312 }).reasons).toEqual([
      'no panel shows errors = 312: the panels show no single number',
    ]);
  });

  test('says when the truth could not be computed, and has nothing to say when none was recorded', () => {
    const stat = { panelId: 'errors', queries: [], shown: 312 };
    expect(scored([check], built([stat]), { errors: null }).reasons).toEqual([
      'the truth errors could not be computed',
    ]);
    expect(scored([check], built([stat]), {}).pass).toBe(true);
  });
});

describe('a panel adds up, per group, to what the data holds', () => {
  const check = totalsMatch(byName, { relative: 0.005 });
  const truth = { byName: { START: 4320, ERROR: 312 } };

  test('every group of the truth is there with its total; other groups are allowed', () => {
    const totals = { START: 4320, ERROR: 312, HEARTBEAT: 12253 };
    const panel = { panelId: 'by-name', queries: [query({ rowCount: 96, totals })] };
    expect(scored([check], built([panel]), truth).pass).toBe(true);
  });

  test('a missing group or a wrong total fails, and says what the panel adds up to', () => {
    const missing = { panelId: 'p', queries: [query({ rowCount: 2, totals: { START: 4320 } })] };
    expect(scored([check], built([missing]), truth).reasons).toEqual([
      'no panel adds up to byName = {"START":4320,"ERROR":312}: one adds up to {"START":4320}',
    ]);
    const wrong = { panelId: 'p', queries: [query({ totals: { START: 4320, ERROR: 99 } })] };
    expect(scored([check], built([wrong]), truth).pass).toBe(false);
  });

  test('a panel with no total per group fails', () => {
    const plain = { panelId: 'p', queries: [query({ rowCount: 1, rows: [[312]] })] };
    expect(scored([check], built([plain]), truth).reasons).toEqual([
      'no panel adds up to byName = {"START":4320,"ERROR":312}: none has a total per group',
    ]);
  });
});
