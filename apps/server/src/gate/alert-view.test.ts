import { describe, expect, test } from 'bun:test';
import type { AccessLevel } from '@quanthea/shared';
import { modelAlertCheck, modelAlertReplay, replayRefusal } from './alert-view.ts';
import type { GateSubject } from './subject.ts';

/**
 * A connector at an access level, with the `owner` label hidden.
 *
 * @param accessLevel - The level.
 * @returns The subject.
 */
function subject(accessLevel: AccessLevel): GateSubject {
  return {
    name: 'prom',
    kind: 'prometheus',
    accessLevel,
    hiddenFields: ['owner'],
    descriptions: {},
  };
}

const series = [
  { labels: { service: 'checkout', owner: 'ana@example.com' }, value: 0.031, holds: true },
  { labels: { service: 'cart', owner: 'bo@example.com' }, value: 0.002, holds: false },
];

const replay = {
  replayable: true as const,
  from: Date.UTC(2026, 8, 27),
  to: Date.UTC(2026, 9, 4),
  truncated: false,
  series: [
    {
      labels: { service: 'cart', owner: 'bo@example.com' },
      firing: [],
      firings: 0,
      firingMs: 0,
      tooShort: [
        { from: Date.UTC(2026, 9, 1, 11, 40), to: Date.UTC(2026, 9, 1, 11, 43), peak: 0.024 },
      ],
      points: [{ at: 1, value: 0.0123456 }],
    },
    {
      labels: { service: 'checkout', owner: 'ana@example.com' },
      firing: [
        { from: Date.UTC(2026, 9, 3, 14, 4), to: Date.UTC(2026, 9, 3, 14, 20), ongoing: false },
      ],
      firings: 1,
      firingMs: 16 * 60_000,
      tooShort: [],
      points: [{ at: 1, value: 0.0123456 }],
    },
  ],
};

describe('an alert check as the model sees it', () => {
  test('says only that the query ran at level 1', () => {
    expect(modelAlertCheck(subject(1), series)).toEqual({
      level: 1,
      note: 'The query ran. Your access level shows nothing of its result.',
    });
  });

  test('counts the series and names their visible labels at level 2', () => {
    expect(modelAlertCheck(subject(2), series)).toEqual({
      level: 2,
      seriesCount: 2,
      labelNames: ['service'],
    });
  });

  test('shows labels and values from level 3, never a hidden label', () => {
    const view = modelAlertCheck(subject(3), series);
    expect(view).toMatchObject({ level: 3, seriesCount: 2, holdingNow: 1 });
    expect(JSON.stringify(view)).toContain('service=checkout');
    expect(JSON.stringify(view)).not.toContain('example.com');
  });
});

describe('a replay as the model sees it', () => {
  test('is refused below level 3', () => {
    expect(modelAlertReplay(subject(2), replay)).toEqual({ ok: false, error: replayRefusal });
  });

  test('summarizes counts and periods, the series that fired most first, with no points', () => {
    const view = modelAlertReplay(subject(3), replay);
    expect(view).toMatchObject({
      ok: true,
      seriesCount: 2,
      seriesThatFired: 1,
      firings: 1,
      firingMinutes: 16,
      tooShort: 1,
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain('0.0123456');
    expect(text).not.toContain('example.com');
    expect(text.indexOf('service=checkout')).toBeLessThan(text.indexOf('service=cart'));
    expect(text).toContain('"from":"2026-10-03T14:04Z","to":"2026-10-03T14:20Z"');
  });

  test('passes on why a draft cannot be replayed', () => {
    expect(modelAlertReplay(subject(4), { replayable: false, reason: 'No time.' })).toEqual({
      ok: false,
      error: 'No time.',
    });
  });
});
