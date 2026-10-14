import { expect, test } from 'bun:test';
import { reportSpecSchema } from '@quanthea/shared';
import {
  mergeReport,
  type ReportEdit,
  type ReportTiming,
  startingDashboard,
} from './report-edit.ts';

const timing: ReportTiming = {
  schedule: { every: 'day', at: '08:00', timezone: 'UTC' },
  period: 'previous_day',
  range: { from: Date.UTC(2026, 9, 13), to: Date.UTC(2026, 9, 14) },
};

const edit = { title: 'Daily orders', summary: 'A report.' } as ReportEdit;

test('a report edit keeps the colours its dashboard has, and a new report has none', () => {
  const start = startingDashboard(undefined, edit, timing);
  expect(start?.colors).toEqual([]);
  if (!start) throw new Error('No starting dashboard.');
  const colors = [{ value: 'failed', tone: 'bad' as const }];
  const merged = mergeReport(undefined, { ...start, colors }, edit, timing);
  expect(merged.colors).toEqual(colors);
  expect(reportSpecSchema.parse(merged).colors).toEqual(colors);
});
