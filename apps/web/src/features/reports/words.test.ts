import { describe, expect, test } from 'bun:test';
import type { ReportRunSummary } from '@quanthea/shared';
import { lastRunWords, nextRunWords, ranLine, runTitle, scheduleLine } from './words.ts';

/** Monday 6 October 2025 at 08:00 in Zurich. */
const monday = Date.parse('2025-10-06T06:00:00Z');

/** A run of week 40, with its first headline. */
const run: ReportRunSummary = {
  id: 'r1',
  reportId: 'w',
  version: 1,
  trigger: 'schedule',
  status: 'ok',
  attempts: 1,
  retryAt: null,
  error: null,
  period: { from: 0, to: 1, label: 'week 40, 29 Sep – 5 Oct' },
  comparison: { from: 0, to: 1, label: 'week 39, 22 – 28 Sep' },
  headlines: [
    {
      panelId: 'revenue',
      title: 'Revenue',
      value: 184_320,
      text: 'CHF 184,320',
      previous: 173_560,
      previousText: 'CHF 173,560',
      change: { direction: 'up', text: '▲ 6.2%' },
    },
  ],
  startedBy: null,
  createdAt: monday,
  ranAt: monday,
  sentAt: monday,
};

describe('a report in words', () => {
  test('the schedule and the period', () => {
    const at = { at: '08:00', timezone: 'Europe/Zurich' };
    expect(scheduleLine({ every: 'week', weekday: 'monday', ...at }, 'previous_week')).toBe(
      'Mondays 08:00 · the previous week',
    );
    expect(scheduleLine({ every: 'day', ...at }, 'previous_day')).toBe('Daily 08:00 · yesterday');
    expect(scheduleLine({ every: 'month', day: 1, ...at }, 'previous_month')).toBe(
      'Monthly, the 1st 08:00 · the previous month',
    );
    expect(scheduleLine({ every: 'month', day: 22, ...at }, 'week_to_date')).toBe(
      'Monthly, the 22nd 08:00 · this week so far',
    );
  });

  test('the next run, or why there is none', () => {
    expect(nextRunWords(monday, 'Europe/Zurich', false)).toBe('next Mon 6 Oct 08:00');
    expect(nextRunWords(null, 'Europe/Zurich', true)).toBe('not active');
    expect(nextRunWords(null, 'Europe/Zurich', false)).toBe('deactivated');
  });

  test("a run's title and its line", () => {
    expect(runTitle('week 40, 29 Sep – 5 Oct')).toBe('Week 40 · 29 Sep – 5 Oct');
    const delivery = [
      {
        channelId: 'c1',
        channelName: '#sales',
        ok: true,
        httpStatus: 200,
        attempts: 1,
        error: null,
      },
    ];
    expect(ranLine({ ...run, delivery }, 'Europe/Zurich')).toBe(
      'Ran Mon 6 Oct 08:00 · sent to #sales · frozen: opening it runs no query',
    );
    const failed = {
      ...run,
      status: 'failed' as const,
      attempts: 3,
      error: 'Panel "Revenue": timeout',
    };
    expect(ranLine({ ...failed, delivery: null }, 'Europe/Zurich')).toBe(
      'Failed Mon 6 Oct 08:00 after 3 attempts: Panel "Revenue": timeout',
    );
  });

  test("the list's number: the first headline with its change, or a failure", () => {
    expect(lastRunWords(run)).toEqual({
      kind: 'value',
      caption: 'Revenue, week 40',
      text: 'CHF 184,320',
      change: { direction: 'up', text: '▲ 6.2%' },
    });
    expect(lastRunWords({ ...run, status: 'failed' })).toEqual({
      kind: 'failed',
      text: 'Last run failed',
    });
    expect(lastRunWords(null)).toEqual({ kind: 'none', text: 'No run yet' });
  });
});
