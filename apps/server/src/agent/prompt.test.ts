import { describe, expect, test } from 'bun:test';
import type { Plan } from '@querent/shared';
import { instructionsFor, type TurnFacts } from './prompt.ts';

const plan: Plan = {
  title: 'Checkout',
  variables: [],
  panels: [{ kind: 'stat', title: 'Errors', language: 'sql', connector: 'events' }],
};

const facts: TurnFacts = {
  now: Date.parse('2026-09-28T14:51:00Z'),
  catalog: '## events (memory, sql): level 2',
  state: 'idle',
  plan: undefined,
  draft: undefined,
  mentions: [],
};

describe('instructionsFor', () => {
  test('gives the time in UTC and in the person’s zone', () => {
    expect(instructionsFor({ ...facts, timeZone: 'Europe/Madrid' })).toContain(
      'The person is in Europe/Madrid, where it is 2026-09-28, 16:51.',
    );
    expect(instructionsFor(facts)).toContain("The person's time zone is unknown; assume UTC.");
    expect(instructionsFor({ ...facts, timeZone: 'Mars/Olympus' })).toContain('assume UTC');
  });

  test('says what the thread state asks for', () => {
    expect(instructionsFor(facts)).toContain('No plan yet.');
    expect(
      instructionsFor({ ...facts, state: 'plan_pending', plan: { body: plan, status: 'pending' } }),
    ).toContain('A plan waits for the person to approve it.');
    expect(
      instructionsFor({ ...facts, state: 'building', plan: { body: plan, status: 'approved' } }),
    ).toContain('The approved plan "Checkout"');
  });

  test('gives the spec guide only once there is something to write', () => {
    expect(instructionsFor(facts)).not.toContain('The spec (JSON');
    expect(instructionsFor({ ...facts, state: 'ready' })).toContain('The spec (JSON');
  });

  test('ends with what the phase asks for', () => {
    expect(instructionsFor(facts).endsWith('No plan yet.')).toBe(true);
  });

  test('names the mentioned panels', () => {
    const text = instructionsFor({
      ...facts,
      state: 'ready',
      mentions: [{ panelId: 'errors', title: 'Errors' }],
    });
    expect(text).toContain('The person mentions these panels: errors ("Errors").');
  });
});
