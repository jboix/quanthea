import { describe, expect, test } from 'bun:test';
import { type DashboardQuestion, dashboardSpecSchema } from '@quanthea/shared';
import {
  askedContextOf,
  contextChange,
  drivingAnswer,
  shownContextOf,
} from './ask-conversation.ts';

const hour = 3_600_000;
const start = Date.parse('2026-09-26T11:30:00Z');

/** An answer that cites the errors panel. */
const cited = (n: number) => ({
  mode: 'ask' as const,
  text: `Errors [${n}].`,
  citations: [{ n, panelId: 'errors' }],
  evidence: [],
});

/**
 * A stored question of the conversation `c1`.
 *
 * @param id - Its id.
 * @param changes - What differs from the first question: the version, range, values, outcome.
 * @returns The question.
 */
function question(id: string, changes: Partial<DashboardQuestion> = {}): DashboardQuestion {
  return {
    id,
    dashboardId: 'd1',
    version: 3,
    parentId: null,
    conversationId: 'c1',
    time: { from: start, to: start + hour },
    chosenTime: null,
    timeZone: 'UTC',
    variables: { env: 'prod' },
    hiddenMarkers: [],
    explainOnly: false,
    askedBy: 'Ana',
    askedAt: start,
    question: id,
    outcome: { ok: true, answer: cited(1) },
    tokens: 0,
    ...changes,
  };
}

describe('the context line', () => {
  test('says nothing for the first question, or when nothing shown changed', () => {
    const first = askedContextOf(question('a'));
    expect(contextChange(undefined, first)).toBeUndefined();
    expect(contextChange(first, askedContextOf(question('b')))).toBeUndefined();
  });

  test('names the new range and values when they changed', () => {
    const first = askedContextOf(question('a'));
    const moved = { time: { from: start + 22 * hour, to: start + 23 * hour } };
    expect(contextChange(first, askedContextOf(question('b', moved)))).toBe(
      'Now asking about 27 Sep 09:30–10:30, $env prod',
    );
    const staging = askedContextOf(question('b', { variables: { env: 'staging' } }));
    expect(contextChange(first, staging)).toBe('Now asking about 26 Sep 11:30–12:30, $env staging');
  });

  test('names the version when it changed', () => {
    const first = askedContextOf(question('a'));
    expect(contextChange(first, askedContextOf(question('b', { version: 4 })))).toBe(
      'Now asking about v4, 26 Sep 11:30–12:30, $env prod',
    );
  });

  test('compares the view shown with the question before it', () => {
    const spec = dashboardSpecSchema.parse({
      specVersion: 1,
      title: 'Checkout',
      time: { from: '2026-09-26T11:30:00Z', to: '2026-09-26T12:30:00Z' },
      variables: [{ kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' }],
      panels: [],
    });
    const shown = { version: 3, spec, time: undefined, variables: {}, timeZone: 'UTC', now: 0 };
    const last = askedContextOf(question('a'));
    expect(contextChange(last, shownContextOf(shown))).toBeUndefined();
    const staging = shownContextOf({ ...shown, variables: { env: 'staging' } });
    expect(contextChange(last, staging)).toBe('Now asking about 26 Sep 11:30–12:30, $env staging');
  });
});

describe('a relative range', () => {
  const spec = dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Checkout',
    time: { from: 'now-1h', to: 'now' },
    panels: [],
  });
  const lastHour = { from: 'now-1h', to: 'now' };

  test('is no change when the hour moved on', () => {
    const asked = askedContextOf(question('a', { chosenTime: lastHour, variables: {} }));
    const later = { version: 3, spec, time: undefined, variables: {}, timeZone: 'UTC' };
    expect(
      contextChange(asked, shownContextOf({ ...later, now: start + 7 * hour })),
    ).toBeUndefined();
  });

  test('is a change from another relative range, or from an absolute one', () => {
    const asked = askedContextOf(question('a', { chosenTime: lastHour, variables: {} }));
    const shown = { version: 3, spec, variables: {}, timeZone: 'UTC', now: start + hour };
    const sixHours = shownContextOf({ ...shown, time: { from: 'now-6h', to: 'now' } });
    expect(contextChange(asked, sixHours)).toBe('Now asking about 26 Sep 06:30–12:30');
    const old = askedContextOf(question('b', { variables: {} }));
    expect(contextChange(old, shownContextOf({ ...shown, time: undefined }))).toBeDefined();
  });

  test('matches two spellings of the same absolute instant', () => {
    const iso = { from: '2026-09-26T11:30:00Z', to: '2026-09-26T12:30:00.000+00:00' };
    const asked = askedContextOf(question('a', { chosenTime: iso }));
    expect(contextChange(askedContextOf(question('b')), asked)).toBeUndefined();
  });
});

describe('the answer that marks the charts', () => {
  const failed = { ok: false as const, message: 'No model.', evidence: [] };
  const questions = [
    question('a'),
    question('b', { outcome: { ok: true, answer: cited(2) }, version: 2 }),
    question('c', { outcome: failed }),
  ];

  test('is the latest answered question by default', () => {
    expect(drivingAnswer(questions, undefined, undefined, 3)).toMatchObject({
      questionId: 'b',
      version: 2,
    });
    expect(drivingAnswer([], undefined, undefined, 3)).toBeUndefined();
  });

  test('is the answer just given, about the version shown', () => {
    const live = { outcome: { ok: true, answer: cited(5) } };
    expect(drivingAnswer(questions, undefined, live, 3)).toEqual({
      questionId: undefined,
      version: 3,
      answer: cited(5),
    });
  });

  test('is the answer picked, unless it failed', () => {
    const live = { outcome: { ok: true, answer: cited(5) } };
    expect(drivingAnswer(questions, 'a', live, 3)?.questionId).toBe('a');
    expect(drivingAnswer(questions, 'c', undefined, 3)?.questionId).toBe('b');
  });
});
