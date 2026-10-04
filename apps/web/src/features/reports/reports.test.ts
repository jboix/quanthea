import { describe, expect, test } from 'bun:test';
import type { ReportDetail, ReportListItem, ReportRunDetail } from '@quanthea/shared';
import { startPath } from './follow-up-cards.tsx';
import { settingsFrom } from './report-settings-dialog.tsx';
import { searchReports } from './reports-screen.tsx';
import { canvasSpec } from './run-body.tsx';
import { scheduleAction } from './run-menus.tsx';
import { barHeights } from './value-history.tsx';

/** A weekly report as the list shows it. */
const weekly = {
  id: 'w',
  title: 'Weekly sales',
  activeVersion: 1,
  latestVersion: 1,
  deactivated: false,
  schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
  period: 'previous_week',
  nextRunAt: null,
  lastRun: null,
  threadId: null,
  createdAt: 0,
  updatedAt: 0,
  unseen: true,
  history: [],
} as const satisfies ReportListItem;

describe('the list', () => {
  test('searches titles and schedules, every word', () => {
    const daily = {
      ...weekly,
      id: 'd',
      title: 'Failed payments',
      schedule: { ...weekly.schedule },
    };
    expect(searchReports([weekly, daily], 'sales monday').map((each) => each.id)).toEqual(['w']);
    expect(searchReports([weekly, daily], 'previous week')).toHaveLength(2);
    expect(searchReports([weekly, daily], 'payments nope')).toEqual([]);
  });

  test('the history scales its bars from zero, a missing number drawing none', () => {
    expect(barHeights([10, null, 20, 5])).toEqual([16, 0, 32, 8]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
});

describe('the settings dialog', () => {
  test('reads the fields as settings, empty days keeping runs for good', () => {
    const typed = { maxRetries: '3', retryDelay: '30m', keepRunsDays: '' };
    expect(settingsFrom(typed).settings).toEqual({
      maxRetries: 3,
      retryDelay: '30m',
      keepRunsDays: null,
    });
    expect(settingsFrom({ ...typed, keepRunsDays: '90' }).settings?.keepRunsDays).toBe(90);
  });

  test('says which field does not read', () => {
    const wrong = settingsFrom({ maxRetries: '11', retryDelay: '30s', keepRunsDays: '0' });
    expect(wrong.settings).toBeUndefined();
    expect(Object.keys(wrong.issues).sort()).toEqual(['keepRunsDays', 'maxRetries', 'retryDelay']);
  });
});

describe('a run', () => {
  test('the canvas leaves the headline panels out and moves the rest up', () => {
    const panel = (id: string, y: number) => ({
      id,
      title: id,
      grid: { x: 0, y, w: 3, h: 3 },
      queries: [],
      view: { kind: 'table' },
    });
    const spec = {
      specVersion: 1,
      title: 'Weekly sales',
      variables: [],
      annotations: [],
      panels: [panel('revenue', 0), panel('daily', 3), panel('top', 9)],
      schedule: weekly.schedule,
      period: 'previous_week',
      summaryPanels: ['revenue'],
    };
    const run = {
      spec,
      period: { from: 0, to: 1, label: 'week 40' },
    } as unknown as ReportRunDetail;
    const drawn = canvasSpec(run);
    expect(drawn.panels.map((each) => [each.id, each.grid.y])).toEqual([
      ['daily', 0],
      ['top', 6],
    ]);
    expect(drawn.timezone).toBe('Europe/Zurich');
  });

  test('Change stops a running schedule, and activates a draft or a stopped one', () => {
    const report = { ...weekly, versions: [] } as unknown as ReportDetail;
    expect(scheduleAction(report).label).toBe('Deactivate');
    expect(scheduleAction({ ...report, deactivated: true }).intent).toEqual({
      intent: 'activate',
      version: 1,
    });
    const draft = { ...report, activeVersion: null, latestVersion: 2 };
    expect(scheduleAction(draft).label).toBe('Activate v2');
  });

  test('a card starts its conversation with its words in the box, never sent', () => {
    const card = {
      kind: 'alert' as const,
      title: 'Drop',
      prompt: 'Tell me when revenue drops 40%.',
    };
    expect(startPath(card)).toBe(
      '/threads/new?make=alert&prompt=Tell+me+when+revenue+drops+40%25.',
    );
  });
});
